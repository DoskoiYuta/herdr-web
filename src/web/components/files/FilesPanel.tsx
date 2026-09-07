// Composition root for the read-only Files tab (plan.md F9). Layout mirrors
// DiffPanel: a toolbar (tree toggle + font size, shared with Diff via
// ViewerControls), a resizable tree on the left, a single-file viewer on the
// right that routes by `kind`/extension to MarkdownView or CodeFileView.
// Tree width / font size / tree visibility are shared with Diff through
// `@/lib/viewerSettings` rather than this panel's own localStorage key.

import { useQueryClient } from "@tanstack/react-query";
import type { Ref } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeViewLineSelection } from "@pierre/diffs";
import type { AskTarget } from "@contract/ask";
import type { Repo } from "@contract/events";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast/ToastProvider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PathTree } from "@/components/tree/PathTree";
import { ViewerControls } from "@/components/tool/ViewerControls";
import { previewKindForPath } from "@contract/preview";
import {
  AskLimitError,
  AskUnavailableError,
  askApi,
  FileNotFoundError,
  fsApi,
  gitApi,
  UploadConflictError,
  type ForFileMatch,
} from "@/lib/api";
import { buildAnchor } from "@/lib/anchor";
import { useAskEvents } from "@/lib/HerdrStoreContext";
import { askEventMatchesRepo } from "@/lib/askEvent";
import { agentPanesAt } from "@/lib/sendTargets";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/codeFont";
import { collectDroppedFiles } from "@/lib/dropEntries";
import { MAX_TREE_WIDTH, MIN_TREE_WIDTH, useViewerSettings } from "@/lib/viewerSettings";
import { AskComposer } from "@/components/ask/AskComposer";
import { AskMismatchStrip } from "@/components/ask/AskMismatchStrip";
import { AskThread } from "@/components/ask/AskThread";
import {
  anchoredMatches,
  buildAskAnnotations,
  outdatedMatches,
} from "@/components/ask/askAnnotations";
import type { AskAnnotationMeta } from "@/components/ask/askAnnotations";
import { CodeFileView, type CodeFileViewHandle } from "./CodeFileView";
import { useFile } from "./hooks/useFile";
import { useLs } from "./hooks/useLs";
import { useStatus } from "./hooks/useStatus";
import { MarkdownView } from "./MarkdownView";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FOR_FILE_DEBOUNCE_MS = 200;

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** F10 の質問セッション行「対象ファイルを開く」からのジャンプ先。一度消費したら
 * 親が null に戻す想定（DiffPanel.tsx の `DiffInitialLocation` と同じ流儀）。 */
export interface FilesInitialLocation {
  path: string;
  line: number;
}

export interface FilesPanelProps {
  repo: string;
  repoChangedTick: number;
  pollMs?: number;
  /** リポジトリキー（git-common-dir 絶対パス）。ask API の `repo`。null/未指定なら
   * herdr 未接続などでまだ解決できていない。 */
  repoKey?: string | null;
  /** 送信先候補（agentPanesAt）を引くための実際の git worktree root。
   * サブリポジトリ選択時は `repo`（=表示中のサブリポジトリ root）と異なる。 */
  worktreeRoot?: string | null;
  repos?: Repo[];
  /** 選択中のファイル。URL の `path` (plan.md F14-4) に置く — 消費したら null に
   * 戻す契約は無く、常に呼び出し側 (ToolPane) が URL から渡す。 */
  selectedPath: string | null;
  onSelectedPathChange: (path: string | null) => void;
  /** markdown のソース/プレビュー切替。URL の `md`。 */
  mdMode: "source" | "preview";
  onMdModeChange: (mode: "source" | "preview") => void;
  /** F10: 質問セッションの「対象ファイルを開く」からのジャンプ先。 */
  initialLocation?: FilesInitialLocation | null;
  /** ジャンプ先のファイルを開いたら（スクロールの成否によらず）呼ばれる。親は
   * これを受けて `initialLocation` を null に戻すこと — さもないとポーラー更新
   * のたびに再度同じ場所へジャンプしてしまう（DiffPanel.tsx と同じ理由）。 */
  onInitialLocationConsumed?: () => void;
}

export function FilesPanel({
  repo,
  repoChangedTick,
  pollMs,
  repoKey = null,
  worktreeRoot = null,
  repos = [],
  selectedPath,
  onSelectedPathChange,
  mdMode,
  onMdModeChange,
  initialLocation = null,
  onInitialLocationConsumed,
}: FilesPanelProps) {
  const codeFileViewRef = useRef<CodeFileViewHandle>(null);
  const [settings, updateSettings] = useViewerSettings();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const treeWidth = dragWidth ?? settings.treeWidth;
  const handleTreeResize = useCallback((width: number) => setDragWidth(width), []);
  const handleTreeResizeEnd = useCallback(
    (width: number) => {
      setDragWidth(null);
      updateSettings({ treeWidth: width });
    },
    [updateSettings],
  );

  // Directories whose listing has been requested at least once. Grows only:
  // collapsing a folder keeps its children in the tree (removing them would
  // have to tear down grandchildren first, and the re-expand would just
  // refetch) — the per-tick refetch keeps loaded listings fresh regardless.
  const [loadedDirs, setLoadedDirs] = useState<string[]>([]);
  const handleExpandedDirsChange = useCallback((expanded: string[]) => {
    setLoadedDirs((prev) => {
      const next = expanded.filter((d) => !prev.includes(d));
      return next.length === 0 ? prev : [...prev, ...next];
    });
  }, []);

  const dirs = useMemo(() => ["", ...loadedDirs], [loadedDirs]);
  const ls = useLs(repo, dirs, repoChangedTick, pollMs);
  const statusQuery = useStatus(repo, repoChangedTick, pollMs);
  const previewKind = selectedPath !== null ? previewKindForPath(selectedPath) : null;
  const fileQuery = useFile(repo, selectedPath, repoChangedTick, pollMs, previewKind === null);
  const rawUrl =
    selectedPath !== null
      ? fsApi.rawUrl({ root: repo, path: selectedPath, tick: repoChangedTick })
      : null;

  // F10: ジャンプ先のファイルが選択され、内容の読み込みが確定したら（成功/失敗
  // 問わず）一度だけスクロールして親に消費を通知する。行がファイル末尾を超えて
  // いても scrollTo は無視するだけなので、範囲チェックはしない（best effort）。
  useEffect(() => {
    if (!initialLocation || selectedPath !== initialLocation.path) return;
    if (fileQuery.isPending) return;
    if (fileQuery.data?.kind === "text" && previewKind === null) {
      codeFileViewRef.current?.scrollToLine(initialLocation.line);
    }
    onInitialLocationConsumed?.();
  }, [
    initialLocation,
    selectedPath,
    fileQuery.isPending,
    fileQuery.data,
    previewKind,
    onInitialLocationConsumed,
  ]);

  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  // Reset preview state for the new selection during render (rather than in
  // an effect) so the previous file's dimensions/error never flash for the
  // newly selected one.
  const [previewedPath, setPreviewedPath] = useState<string | null>(null);
  // Range selection (ask composer target) — reset on the same "new file
  // selected" render-time adjustment as the image-preview state above
  // (React's documented "derive state from a changed prop" pattern), since
  // an ask on file A's lines must never survive into file B's viewer.
  // `mdMode` doesn't need the same treatment: it's controlled via the URL and
  // every navigation that changes `selectedPath` also clears `md` (ToolPane).
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const [selecting, setSelecting] = useState(false);
  if (selectedPath !== previewedPath) {
    setPreviewedPath(selectedPath);
    if (imageDims !== null) setImageDims(null);
    if (previewError) setPreviewError(false);
    if (selection !== null) setSelection(null);
  }

  const paths = ls.paths;
  const status = statusQuery.data?.status ?? [];
  const rootError = ls.errors.find((e) => e.dir === "")?.error;

  const queryClient = useQueryClient();
  const toast = useToast();
  const [conflict, setConflict] = useState<{ dir: string; files: File[]; paths: string[] } | null>(
    null,
  );

  const runUpload = useCallback(
    async (dir: string, files: File[], overwrite: boolean) => {
      try {
        const result = await fsApi.upload({ root: repo, dir, files, overwrite });
        void queryClient.invalidateQueries({ queryKey: ["ls", repo] });
        toast({ kind: "success", message: `${result.written.length} 件をインポートしました` });
      } catch (err) {
        if (err instanceof UploadConflictError) {
          setConflict({ dir, files, paths: err.paths });
          return;
        }
        toast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [repo, queryClient, toast],
  );

  // -------------------------------------------------------------------
  // F10: ask composer + inline ask threads. Mirrors DiffPanel.tsx's F5-1/
  // F5-9 wiring (createdAtHead fetch, for-file matches, WS refetch) — files
  // here have exactly one side ("new") and no diff hunks, so there's no
  // per-side line-number mapping to do.
  // -------------------------------------------------------------------
  const headRef = useRef<string | null>(null);
  const [headKnown, setHeadKnown] = useState(false);
  useEffect(() => {
    headRef.current = null;
    setHeadKnown(false);
    if (!repo) return;
    let cancelled = false;
    void gitApi
      .root(repo)
      .then((info) => {
        if (!cancelled) {
          headRef.current = info.head;
          setHeadKnown(true);
        }
      })
      .catch(() => {
        // best-effort: composer stays disabled (headKnown false) until this resolves
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, repoChangedTick]);

  const [matches, setMatches] = useState<ForFileMatch[]>([]);
  const forFileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshMatches = useCallback(() => {
    if (forFileTimerRef.current) clearTimeout(forFileTimerRef.current);
    forFileTimerRef.current = setTimeout(() => {
      const data = fileQuery.data;
      if (!repoKey || !selectedPath || !data || data.kind !== "text") return;
      void askApi
        .forFile({
          repo: repoKey,
          worktreeRoot: repo,
          path: selectedPath,
          lines: data.contents.split("\n"),
        })
        .then(setMatches)
        .catch(() => {
          // インライン表示は best-effort。失敗しても viewer 自体は読める。
        });
    }, FOR_FILE_DEBOUNCE_MS);
  }, [repoKey, repo, selectedPath, fileQuery.data]);

  // A new file selection must not show the previous file's threads even
  // briefly — clear synchronously on the path change rather than waiting for
  // the debounced refetch below.
  useEffect(() => {
    setMatches([]);
  }, [selectedPath]);

  useEffect(() => {
    refreshMatches();
    return () => {
      if (forFileTimerRef.current) clearTimeout(forFileTimerRef.current);
    };
  }, [refreshMatches]);

  useAskEvents(
    useCallback(
      (event) => {
        if (askEventMatchesRepo(event, repoKey)) refreshMatches();
      },
      [refreshMatches, repoKey],
    ),
  );

  const askPanes = useMemo(
    () => (worktreeRoot ? agentPanesAt(repos, worktreeRoot) : []),
    [repos, worktreeRoot],
  );

  // A composer only makes sense while there's a stable (non-in-progress)
  // range selection on a real text file being viewed as source — never for
  // markdown プレビュー, image/pdf preview, or while the mouse is still
  // dragging the selection.
  const canAsk =
    previewKind === null && (!isMarkdownPath(selectedPath ?? "") || mdMode === "source");
  const composerLine = useMemo(() => {
    if (!selection || selecting || !canAsk) return null;
    return Math.max(selection.range.start, selection.range.end);
  }, [selection, selecting, canAsk]);

  const cancelComposer = useCallback(() => setSelection(null), []);

  const submitComposer = useCallback(
    async (body: string, target: AskTarget) => {
      const data = fileQuery.data;
      if (!selection || !repoKey || !selectedPath || !data || data.kind !== "text") {
        toast({ kind: "error", message: "質問を作成できません（リポジトリを解決できていません）" });
        return;
      }
      const lines = data.contents.split("\n");
      const start0 = Math.min(selection.range.start, selection.range.end) - 1;
      const end0 = Math.max(selection.range.start, selection.range.end) - 1;
      try {
        const anchor = await buildAnchor(lines, start0, end0, "new");
        await askApi.create({
          repo: repoKey,
          worktreeRoot: repo,
          path: selectedPath,
          anchor,
          createdAtHead: headRef.current,
          body,
          target,
        });
        setSelection(null);
        refreshMatches();
      } catch (err) {
        if (err instanceof AskLimitError || err instanceof AskUnavailableError) {
          toast({ kind: "error", message: err.message });
        } else {
          toast({ kind: "error", message: "質問の送信に失敗しました" });
        }
      }
    },
    [selection, repoKey, selectedPath, repo, fileQuery.data, refreshMatches, toast],
  );

  const handleAskReply = useCallback(
    async (id: string, body: string) => {
      try {
        await askApi.reply(id, { body, author: "user", agentSession: null });
        refreshMatches();
      } catch {
        toast({ kind: "error", message: "返信に失敗しました" });
      }
    },
    [refreshMatches, toast],
  );

  const handleAskResolve = useCallback(
    async (id: string) => {
      try {
        await askApi.resolve(id);
        // The thread's own GET /api/ask/:id query stops polling once it sees a
        // terminal status, so it can hold data older than this resolve —
        // drop it so nothing stale outlives the for-file refetch below.
        void queryClient.invalidateQueries({ queryKey: ["ask", id] });
        refreshMatches();
      } catch {
        toast({ kind: "error", message: "解決に失敗しました" });
      }
    },
    [refreshMatches, toast, queryClient],
  );

  const handleAskResend = useCallback(
    async (id: string) => {
      try {
        await askApi.resend(id);
        refreshMatches();
      } catch {
        toast({ kind: "error", message: "再送に失敗しました" });
      }
    },
    [refreshMatches, toast],
  );

  const handleAskFocus = useCallback(
    async (id: string) => {
      try {
        await askApi.focus(id);
      } catch {
        toast({ kind: "error", message: "herdr で開けませんでした" });
      }
    },
    [toast],
  );

  const handleExternalDrop = useCallback(
    (target: { dir: string }, dataTransfer: DataTransfer) => {
      void (async () => {
        const files = await collectDroppedFiles(dataTransfer);
        if (files.length === 0) return;
        await runUpload(target.dir, files, false);
      })();
    },
    [runUpload],
  );

  const handleOverwriteConfirm = useCallback(() => {
    if (!conflict) return;
    const { dir, files } = conflict;
    setConflict(null);
    void runUpload(dir, files, true);
  }, [conflict, runUpload]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        toast({ kind: "error", message: "クリップボードにコピーできませんでした" });
      }
    },
    [toast],
  );

  const [trashTarget, setTrashTarget] = useState<{
    path: string;
    kind: "file" | "directory";
  } | null>(null);

  const handleTrashConfirm = useCallback(() => {
    if (!trashTarget) return;
    const { path } = trashTarget;
    setTrashTarget(null);
    void (async () => {
      try {
        await fsApi.trash({ root: repo, path });
        void queryClient.invalidateQueries({ queryKey: ["ls", repo] });
        // The trashed path may be a directory that contained the currently
        // selected file — clear the selection for either case so the
        // viewer doesn't keep showing a file that no longer exists.
        if (
          selectedPath !== null &&
          (selectedPath === path || selectedPath.startsWith(`${path}/`))
        ) {
          onSelectedPathChange(null);
        }
        toast({ kind: "success", message: `ゴミ箱に移動しました: ${path}` });
      } catch (err) {
        // TrashUnavailableError's own message is already the user-facing
        // 「この環境では...」 text, so no special-casing is needed here.
        toast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [trashTarget, repo, queryClient, toast, selectedPath, onSelectedPathChange]);

  const contextMenuItems = useCallback(
    (item: { path: string; kind: "file" | "directory" }) => {
      const relPath = item.kind === "directory" ? item.path.replace(/\/$/, "") : item.path;
      return [
        { label: "相対パスをコピー", onSelect: () => void copyToClipboard(relPath) },
        { label: "絶対パスをコピー", onSelect: () => void copyToClipboard(`${repo}/${relPath}`) },
        {
          label: "ゴミ箱に移動",
          onSelect: () => setTrashTarget({ path: relPath, kind: item.kind }),
        },
      ];
    },
    [repo, copyToClipboard],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-1">
        <ViewerControls
          showTree={settings.showTree}
          onToggleTree={() => updateSettings({ showTree: !settings.showTree })}
          onFontDec={() =>
            updateSettings({ fontSize: Math.max(MIN_FONT_SIZE, settings.fontSize - 1) })
          }
          onFontInc={() =>
            updateSettings({ fontSize: Math.min(MAX_FONT_SIZE, settings.fontSize + 1) })
          }
        />
      </div>
      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>既存のファイルと衝突しました</DialogTitle>
          </DialogHeader>
          <ul className="max-h-60 overflow-auto text-sm">
            {conflict?.paths.map((p) => (
              <li key={p} className="truncate font-mono">
                {p}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConflict(null)}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleOverwriteConfirm}>
              上書き
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={trashTarget !== null} onOpenChange={(open) => !open && setTrashTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ゴミ箱に移動</DialogTitle>
          </DialogHeader>
          <p className="break-all font-mono text-sm">{trashTarget?.path}</p>
          {trashTarget?.kind === "directory" && (
            <p className="text-xs text-muted-foreground">ディレクトリの場合は中身ごと移動します</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTrashTarget(null)}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleTrashConfirm}>
              ゴミ箱に移動
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex min-h-0 flex-1">
        {settings.showTree && (
          <>
            <div style={{ width: treeWidth }} className="min-h-0 shrink-0">
              <PathTree
                paths={paths}
                gitStatus={status}
                initialExpansion="closed"
                fontSize={settings.fontSize}
                selectedPath={selectedPath}
                onSelectFile={onSelectedPathChange}
                onExpandedDirsChange={handleExpandedDirsChange}
                contextMenuItems={contextMenuItems}
                onExternalDrop={handleExternalDrop}
              />
            </div>
            <ResizeHandle
              width={treeWidth}
              min={MIN_TREE_WIDTH}
              max={MAX_TREE_WIDTH}
              defaultWidth={settings.treeWidth}
              onResize={handleTreeResize}
              onResizeEnd={handleTreeResizeEnd}
            />
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {rootError !== undefined && (
            <p className="shrink-0 border-b border-border px-2 py-1 text-xs text-destructive">
              {rootError instanceof Error ? rootError.message : String(rootError)}
            </p>
          )}
          {selectedPath !== null && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
              <span className="truncate">{selectedPath}</span>
              <div className="flex shrink-0 items-center gap-2">
                {previewKind === null && isMarkdownPath(selectedPath) && (
                  <div className="flex gap-1" role="group" aria-label="表示モード">
                    <button
                      type="button"
                      className={mdMode === "preview" ? "font-semibold text-foreground" : ""}
                      onClick={() => onMdModeChange("preview")}
                    >
                      プレビュー
                    </button>
                    <button
                      type="button"
                      className={mdMode === "source" ? "font-semibold text-foreground" : ""}
                      onClick={() => onMdModeChange("source")}
                    >
                      ソース
                    </button>
                  </div>
                )}
                {previewKind === "image" && imageDims && (
                  <span>
                    {imageDims.width}×{imageDims.height}
                  </span>
                )}
                {fileQuery.data && "size" in fileQuery.data && (
                  <span>{fileQuery.data.size} bytes</span>
                )}
              </div>
            </div>
          )}
          <AskMismatchStrip
            matches={outdatedMatches(matches)}
            onReply={handleAskReply}
            onResolve={handleAskResolve}
            onResend={handleAskResend}
            onFocus={handleAskFocus}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            <FileViewerBody
              codeFileViewRef={codeFileViewRef}
              selectedPath={selectedPath}
              previewKind={previewKind}
              rawUrl={rawUrl}
              previewError={previewError}
              onImageLoad={(width, height) => setImageDims({ width, height })}
              onPreviewError={() => setPreviewError(true)}
              fileQuery={fileQuery}
              fontSize={settings.fontSize}
              mdMode={mdMode}
              selection={selection}
              onSelectedLinesChange={setSelection}
              onLineSelectionStart={() => setSelecting(true)}
              onLineSelectionEnd={() => setSelecting(false)}
              matches={anchoredMatches(matches)}
              composerLine={composerLine}
              askPanes={askPanes}
              askDisabled={!headKnown}
              onCancelComposer={cancelComposer}
              onSubmitComposer={submitComposer}
              onAskReply={handleAskReply}
              onAskResolve={handleAskResolve}
              onAskResend={handleAskResend}
              onAskFocus={handleAskFocus}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FileViewerBody({
  codeFileViewRef,
  selectedPath,
  previewKind,
  rawUrl,
  previewError,
  onImageLoad,
  onPreviewError,
  fileQuery,
  fontSize,
  mdMode,
  selection,
  onSelectedLinesChange,
  onLineSelectionStart,
  onLineSelectionEnd,
  matches,
  composerLine,
  askPanes,
  askDisabled,
  onCancelComposer,
  onSubmitComposer,
  onAskReply,
  onAskResolve,
  onAskResend,
  onAskFocus,
}: {
  codeFileViewRef: Ref<CodeFileViewHandle>;
  selectedPath: string | null;
  previewKind: "image" | "pdf" | null;
  rawUrl: string | null;
  previewError: boolean;
  onImageLoad: (width: number, height: number) => void;
  onPreviewError: () => void;
  fileQuery: ReturnType<typeof useFile>;
  fontSize: number;
  mdMode: "source" | "preview";
  selection: CodeViewLineSelection | null;
  onSelectedLinesChange: (selection: CodeViewLineSelection | null) => void;
  onLineSelectionStart: () => void;
  onLineSelectionEnd: () => void;
  matches: ForFileMatch[];
  composerLine: number | null;
  askPanes: ReturnType<typeof agentPanesAt>;
  askDisabled: boolean;
  onCancelComposer: () => void;
  onSubmitComposer: (body: string, target: AskTarget) => void | Promise<void>;
  onAskReply: (id: string, body: string) => void | Promise<void>;
  onAskResolve: (id: string) => void | Promise<void>;
  onAskResend: (id: string) => void | Promise<void>;
  onAskFocus: (id: string) => void | Promise<void>;
}) {
  if (selectedPath === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        ファイルを選択してください
      </div>
    );
  }

  if (previewKind === "image" && rawUrl !== null) {
    if (previewError) {
      return (
        <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
          プレビューを読み込めませんでした
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted p-4">
        <img
          src={rawUrl}
          alt={selectedPath}
          className="max-h-full max-w-full object-contain"
          onLoad={(e) => onImageLoad(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={onPreviewError}
        />
      </div>
    );
  }

  if (previewKind === "pdf" && rawUrl !== null) {
    // No `sandbox` attribute: Chrome's built-in PDF viewer needs its usual
    // capabilities (it's the browser's own trusted viewer, not page script).
    return <iframe src={rawUrl} title={selectedPath} className="h-full w-full" />;
  }

  if (fileQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        読み込み中…
      </div>
    );
  }

  if (fileQuery.isError) {
    const message =
      fileQuery.error instanceof FileNotFoundError
        ? "ファイルがありません（削除済み）"
        : fileQuery.error instanceof Error
          ? fileQuery.error.message
          : String(fileQuery.error);
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        {message}
      </div>
    );
  }

  const data = fileQuery.data;
  if (!data) return null;

  if (data.kind === "binary") {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        バイナリファイル ({data.size} bytes)
      </div>
    );
  }

  if (data.kind === "too-large") {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        大きすぎるため表示しません ({data.size} bytes、上限 {MAX_FILE_BYTES / (1024 * 1024)} MiB)
      </div>
    );
  }

  if (isMarkdownPath(data.path) && mdMode === "preview") {
    return <MarkdownView contents={data.contents} />;
  }

  const annotations = buildAskAnnotations(matches, composerLine);
  const renderAnnotation = (annotation: { metadata?: AskAnnotationMeta }) => {
    const meta = annotation.metadata;
    if (!meta) return null;
    if (meta.kind === "composer") {
      return (
        <AskComposer
          panes={askPanes}
          disabled={askDisabled}
          onCancel={onCancelComposer}
          onSubmit={onSubmitComposer}
        />
      );
    }
    return (
      <div className="flex flex-col">
        {meta.matches.map((match) => (
          <AskThread
            key={match.ask.id}
            match={match}
            range={
              match.startLine !== null && match.endLine !== null
                ? { start: match.startLine, end: match.endLine }
                : undefined
            }
            onReply={onAskReply}
            onResolve={onAskResolve}
            onResend={onAskResend}
            onFocus={onAskFocus}
          />
        ))}
      </div>
    );
  };

  return (
    <CodeFileView
      ref={codeFileViewRef}
      path={data.path}
      contents={data.contents}
      fontSize={fontSize}
      selectedLines={selection}
      onSelectedLinesChange={onSelectedLinesChange}
      onLineSelectionStart={onLineSelectionStart}
      onLineSelectionEnd={onLineSelectionEnd}
      annotations={annotations}
      renderAnnotation={renderAnnotation}
    />
  );
}

export default FilesPanel;
