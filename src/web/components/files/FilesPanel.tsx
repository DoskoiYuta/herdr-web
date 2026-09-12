// Composition root for the read-only Files tab (plan.md F9). Layout: one
// header row (tree toggle, file tab bar, view-settings menu), a resizable
// tree on the left, a single-file viewer on the right that routes by
// `kind`/extension to MarkdownView or CodeFileView. Tree width / font size /
// tree visibility are shared with Diff through `@/lib/viewerSettings` rather
// than this panel's own localStorage key.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Ref } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, FileQuestion, FileWarning, FolderTree, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodeViewLineSelection } from "@pierre/diffs";
import type { Anchor } from "@contract/review";
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
import { gitStatusLetter, gitStatusLetterColor } from "@/components/tree/gitStatusDecoration";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelState } from "@/components/ui/status/PanelState";
import { previewKindForPath } from "@contract/preview";
import {
  askApi,
  configApi,
  FileNotFoundError,
  fsApi,
  gitApi,
  UploadConflictError,
  type ForFileMatch,
} from "@/lib/api";
import { buildAnchor } from "@/lib/anchor";
import { useAskEvents } from "@/lib/HerdrStoreContext";
import { askEventMatchesRepo } from "@/lib/askEvent";
import { liveAskSessionCount, sendTargetsFor } from "@/lib/sendTargets";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/codeFont";
import { collectDroppedFiles } from "@/lib/dropEntries";
import { closeTab, useFileTabs } from "@/lib/fileTabs";
import { useFileScroll } from "@/lib/fileScroll";
import { MAX_TREE_WIDTH, MIN_TREE_WIDTH, useViewerSettings } from "@/lib/viewerSettings";
import { formatBytes } from "@/lib/formatBytes";
import { languageLabel } from "@/lib/languageLabel";
import { Badge } from "@/components/ui/badge";
import { AskComposer } from "@/components/ask/AskComposer";
import { AskMismatchStrip } from "@/components/ask/AskMismatchStrip";
import { AskTargetDialog } from "@/components/ask/AskTargetDialog";
import { AskThread } from "@/components/ask/AskThread";
import {
  anchoredMatches,
  buildAskAnnotations,
  outdatedMatches,
} from "@/components/ask/askAnnotations";
import type { AskAnnotationMeta } from "@/components/ask/askAnnotations";
import { CodeFileView, type CodeFileViewHandle } from "./CodeFileView";
import { FileTabBar } from "./FileTabBar";
import { HtmlFileView } from "./HtmlFileView";
import { useFile } from "./hooks/useFile";
import { useLs } from "./hooks/useLs";
import { useStatus } from "./hooks/useStatus";
import { MarkdownView } from "./MarkdownView";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FOR_FILE_DEBOUNCE_MS = 200;

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function isHtmlPath(path: string): boolean {
  return /\.(html|htm)$/i.test(path);
}

/** Paths that get the プレビュー/ソース toggle instead of always showing the
 * code viewer. */
function hasPreviewToggle(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path);
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
  repos?: Repo[];
  /** 選択中のファイル。URL の `path` (plan.md F14-4) に置く — 消費したら null に
   * 戻す契約は無く、常に呼び出し側 (ToolPane) が URL から渡す。 */
  selectedPath: string | null;
  onSelectedPathChange: (path: string | null) => void;
  /** `selectedPath` が null のとき、開いているファイルタブ列（repoKey 単位、
   * fileTabs.ts）の `active` を URL へ自動で書き戻す処理を止める。ToolPane が
   * 別 worktree への意図したジャンプの適用待ち（`rootPending`）や、worktree
   * 切り替えで search を空にする navigate がまだ commit していない
   * （`searchCleared`）間に立てる — この間に書き戻すと、その直後/同時に
   * ToolPane 自身が発行する navigate と競合する（同一 tick の二重 navigate、
   * または無関係な path の上書き）。 */
  restoreSuppressed?: boolean;
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
  repos = [],
  selectedPath,
  onSelectedPathChange,
  restoreSuppressed = false,
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

  // ファイルタブ列（リポジトリ単位で永続化、ui-redesign.md §5.4）。URL の
  // `path` が正で、タブ列はそれに追従する側 — ツリークリック・Inbox/質問からの
  // ジャンプ・リロードのいずれでも、選ばれた path がタブに無ければ追加して
  // アクティブにする。逆方向（タブクリック→URL）は下の `handleTabSelect` 等が
  // `onSelectedPathChange` を呼ぶことで揃える。
  //
  // `selectedPath` が null のときは、その repoKey のタブ列に `active`（前回・
  // 他ウィンドウで選んでいた復元用の記録）があれば URL へ書き戻す — リロード
  // 直後に path 無しで着地したときも、worktree 切り替えで ToolPane が path を
  // 落とした直後も、同じ 1 つの規則で塞ぐ。`restoreSuppressed` の間（ToolPane
  // が別 worktree へのジャンプ待ち・search クリアの navigate 未 commit）は
  // 書き戻さない。
  const [tabs, tabActions] = useFileTabs(repoKey);
  const fileScroll = useFileScroll(repoKey);
  const scrollMode =
    mdMode === "preview" && hasPreviewToggle(selectedPath ?? "") ? "preview" : "source";
  // Split into two effects so that closing a tab (which updates `tabs.active`
  // via the store) can never re-trigger `open` before the resulting navigate
  // has landed on `selectedPath` — `path` comes from the URL, so a close can
  // leave `selectedPath` pointing at the just-closed tab for a render or two.
  // A single effect keyed on both `selectedPath` and `tabs.active` would fire
  // in that gap and reopen the tab it was supposed to close.
  useEffect(() => {
    if (selectedPath !== null) tabActions.open(selectedPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, repoKey]);
  useEffect(() => {
    if (selectedPath !== null) return;
    if (restoreSuppressed) return;
    if (tabs.active !== null) onSelectedPathChange(tabs.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, repoKey, restoreSuppressed, tabs.active]);

  // タブバー上の「アクティブ」表示は共有ストアの `tabs.active` ではなく必ず
  // 自分の `selectedPath` から決める — `tabs.active` は他のブラウザウィンドウ
  // の操作でも書き換わる（同じ repoKey を共有するため）ため、それをハイライト
  // に使うと自分がまだ見ている・選んでいるファイルのタブが他ウィンドウの操作で
  // 動いたり消えたりして見える。ストアの `active` はリロード時の復元用にだけ
  // 使う（上の effect）。
  const handleTabClose = useCallback(
    (path: string) => {
      const wasActive = selectedPath === path;
      const next = closeTab({ paths: tabs.paths, active: selectedPath }, path);
      tabActions.close(path);
      if (wasActive) onSelectedPathChange(next.active);
    },
    [tabs.paths, selectedPath, tabActions, onSelectedPathChange],
  );
  const handleTabCloseOthers = useCallback(
    (path: string) => {
      tabActions.closeOthers(path);
      if (selectedPath !== path) onSelectedPathChange(path);
    },
    [tabActions, selectedPath, onSelectedPathChange],
  );
  const handleTabCloseAll = useCallback(() => {
    tabActions.closeAll();
    onSelectedPathChange(null);
  }, [tabActions, onSelectedPathChange]);

  // 開いているタブ分だけの一括存在確認（GET /api/fs/stat）。worktree
  // （root）が変わったとき・Files タブがマウントされたときに走る — どちらも
  // queryKey に root を含めた上でのマウント時フェッチで自然にカバーされる。
  // `repoChangedTick` もキーに含める（useStatus/useFile と同じ規約）—
  // ゴミ箱で消した・checkout で消えたファイルは worktree root 自体もパスの
  // 集合も変わらないため、tick が無いと既存のキャッシュが古い存在判定を
  // 返し続ける。
  const statQuery = useQuery({
    queryKey: ["fs-stat", repo, repoChangedTick, tabs.paths],
    queryFn: () => fsApi.stat({ root: repo, paths: tabs.paths }),
    enabled: tabs.paths.length > 0,
    staleTime: Infinity,
  });
  const tabExists = statQuery.data ?? {};
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
  /** 実寸 / フィットの切替（ui-redesign.md §5.4）。クリックでトグル。 */
  const [imageZoomed, setImageZoomed] = useState(false);
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
    if (imageZoomed) setImageZoomed(false);
    if (previewError) setPreviewError(false);
    if (selection !== null) setSelection(null);
  }

  const paths = ls.paths;
  const status = useMemo(() => statusQuery.data?.status ?? [], [statusQuery.data]);
  const statusDecorations = useMemo(() => {
    const map = new Map<string, { text: string; parts: { text: string; color: string }[] }>();
    for (const entry of status) {
      const text = gitStatusLetter(entry.status);
      if (!text) continue;
      map.set(entry.path, { text, parts: [{ text, color: gitStatusLetterColor(entry.status) }] });
    }
    return map;
  }, [status]);
  const rootError = ls.errors.find((e) => e.dir === "")?.error;

  const queryClient = useQueryClient();
  const toast = useToast();
  const [conflict, setConflict] = useState<{ dir: string; files: File[]; paths: string[] } | null>(
    null,
  );

  const runUpload = useCallback(
    async (dir: string, files: File[], overwrite: boolean) => {
      toast({
        kind: "info",
        message: `インポート中… (${files.length} 件)`,
        sticky: true,
        id: "upload",
      });
      try {
        const result = await fsApi.upload({ root: repo, dir, files, overwrite });
        void queryClient.invalidateQueries({ queryKey: ["ls", repo] });
        toast({
          kind: "success",
          message: `${result.written.length} 件をインポートしました`,
          id: "upload",
        });
      } catch (err) {
        if (err instanceof UploadConflictError) {
          toast.dismiss("upload");
          setConflict({ dir, files, paths: err.paths });
          return;
        }
        toast({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
          id: "upload",
        });
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

  // `repo`/`repoKey` はすでに実効値（サブリポジトリ選択中はそのもの） —
  // サーバーの通知宛先探索（herdr-notifier.ts）と同じスコープで候補を絞る
  // （§10.6）。
  const askPanes = useMemo(
    () => (repoKey ? sendTargetsFor(repos, repo, repoKey) : []),
    [repos, repo, repoKey],
  );

  // A composer only makes sense while there's a stable (non-in-progress)
  // range selection on a real text file being viewed as source — never for
  // markdown プレビュー, image/pdf preview, or while the mouse is still
  // dragging the selection.
  const canAsk =
    previewKind === null && (!hasPreviewToggle(selectedPath ?? "") || mdMode === "source");
  const composerLine = useMemo(() => {
    if (!selection || selecting || !canAsk) return null;
    return Math.max(selection.range.start, selection.range.end);
  }, [selection, selecting, canAsk]);

  const cancelComposer = useCallback(() => setSelection(null), []);

  const clientConfigQuery = useQuery({ queryKey: ["client-config"], queryFn: configApi.get });

  // 送信先ダイアログ（AskTargetDialog）に渡す確定済みのアンカー・本文。ダイアログ
  // 自体は askApi.create の呼び出しと失敗時の toast を持つ — ここは開閉と
  // アンカー構築だけ担当する。
  const [pendingAsk, setPendingAsk] = useState<{
    body: string;
    anchor: Anchor;
    location: string;
    path: string;
    worktreeRoot: string;
    createdAtHead: string | null;
  } | null>(null);

  const openAskTargetDialog = useCallback(
    async (body: string) => {
      const data = fileQuery.data;
      if (!selection || !repoKey || !selectedPath || !data || data.kind !== "text") {
        toast({ kind: "error", message: "質問を作成できません（リポジトリを解決できていません）" });
        return;
      }
      const lines = data.contents.split("\n");
      const start0 = Math.min(selection.range.start, selection.range.end) - 1;
      const end0 = Math.max(selection.range.start, selection.range.end) - 1;
      const anchor = await buildAnchor(lines, start0, end0, "new");
      const start1 = start0 + 1;
      const end1 = end0 + 1;
      const location =
        start1 === end1 ? `${selectedPath}:L${start1}` : `${selectedPath}:L${start1}–${end1}`;
      setPendingAsk({
        body,
        anchor,
        location,
        path: selectedPath,
        worktreeRoot: repo,
        createdAtHead: headRef.current,
      });
    },
    [selection, repoKey, selectedPath, repo, fileQuery.data, toast],
  );

  const handleAskCreated = useCallback(() => {
    setPendingAsk(null);
    setSelection(null);
    refreshMatches();
  }, [refreshMatches]);

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

  const [dragOverDir, setDragOverDir] = useState<string | null>(null);

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
        // The tab itself stays open (it may still hold other, unrelated tabs
        // under a trashed directory too) — the bulk existence check
        // (fs-stat, keyed on repoChangedTick) picks up the removal and marks
        // it missing/strikethrough, same as a file absent because of a
        // worktree switch. Only the currently viewed selection needs
        // clearing here, for the directory case where the deleted path
        // isn't the exact tab path (`selectedPath` inside a removed dir):
        // the "restore the active tab when nothing is selected" rule then
        // re-selects it if it's still the repo's remembered active tab,
        // and the viewer naturally shows the not-found state for it.
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
        <Button
          id="btn-tree"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="ファイルツリー"
          aria-pressed={settings.showTree}
          onClick={() => updateSettings({ showTree: !settings.showTree })}
        >
          <PanelLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <FileTabBar
            paths={tabs.paths}
            activePath={selectedPath}
            exists={tabExists}
            decorations={statusDecorations}
            onSelect={onSelectedPathChange}
            onClose={handleTabClose}
            onCloseOthers={handleTabCloseOthers}
            onCloseAll={handleTabCloseAll}
            onReorder={tabActions.reorder}
            onCopyPath={(path) => void copyToClipboard(path)}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="btn-view-settings"
              type="button"
              variant="ghost"
              size="icon-sm"
              title="表示設定"
            >
              <Ellipsis aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto">
            <div className="flex items-center gap-2 text-sm">
              <span>文字サイズ</span>
              <Button
                id="btn-font-dec"
                type="button"
                variant="ghost"
                size="icon-sm"
                title="文字を小さく"
                disabled={settings.fontSize <= MIN_FONT_SIZE}
                onClick={() =>
                  updateSettings({ fontSize: Math.max(MIN_FONT_SIZE, settings.fontSize - 1) })
                }
                className="text-xs"
              >
                A-
              </Button>
              <span className="w-5 text-center tabular-nums">{settings.fontSize}</span>
              <Button
                id="btn-font-inc"
                type="button"
                variant="ghost"
                size="icon-sm"
                title="文字を大きく"
                disabled={settings.fontSize >= MAX_FONT_SIZE}
                onClick={() =>
                  updateSettings({ fontSize: Math.min(MAX_FONT_SIZE, settings.fontSize + 1) })
                }
                className="text-xs"
              >
                A+
              </Button>
            </div>
          </PopoverContent>
        </Popover>
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
      {pendingAsk && repoKey && (
        <AskTargetDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingAsk(null);
          }}
          location={pendingAsk.location}
          body={pendingAsk.body}
          createParams={{
            repo: repoKey,
            worktreeRoot: pendingAsk.worktreeRoot,
            path: pendingAsk.path,
            anchor: pendingAsk.anchor,
            createdAtHead: pendingAsk.createdAtHead,
          }}
          agents={clientConfigQuery.data?.ask.agents ?? []}
          defaultAgent={clientConfigQuery.data?.ask.defaultAgent ?? ""}
          maxSessions={clientConfigQuery.data?.ask.maxSessions ?? 0}
          activeSessions={liveAskSessionCount(repos)}
          panes={askPanes}
          onCreated={handleAskCreated}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {settings.showTree && (
          <>
            <div style={{ width: treeWidth }} className="flex min-h-0 shrink-0 flex-col">
              <div className="min-h-0 flex-1">
                <PathTree
                  paths={paths}
                  gitStatus={status}
                  decorations={statusDecorations}
                  initialExpansion="closed"
                  fontSize={settings.fontSize}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectedPathChange}
                  onExpandedDirsChange={handleExpandedDirsChange}
                  contextMenuItems={contextMenuItems}
                  onExternalDrop={handleExternalDrop}
                  onExternalDragOver={setDragOverDir}
                />
              </div>
              {dragOverDir !== null && (
                <div className="shrink-0 border-t border-border bg-[color-mix(in_srgb,var(--focus)_10%,transparent)] px-2 py-1 text-xs text-muted-foreground">
                  {dragOverDir === "" ? "/" : `${dragOverDir}/`} にドロップして取り込む
                </div>
              )}
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
              <span className="truncate">
                {[
                  selectedPath,
                  fileQuery.data && "size" in fileQuery.data
                    ? formatBytes(fileQuery.data.size)
                    : null,
                  languageLabel(selectedPath),
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ")}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {matches.length > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    質問 {matches.length}
                  </Badge>
                )}
                {previewKind === null && hasPreviewToggle(selectedPath) && (
                  <Tabs value={mdMode} onValueChange={(v) => onMdModeChange(v as typeof mdMode)}>
                    <TabsList>
                      <TabsTrigger value="preview">プレビュー</TabsTrigger>
                      <TabsTrigger value="source">ソース</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                {previewKind === "image" && imageDims && (
                  <span>
                    {imageDims.width}×{imageDims.height}
                  </span>
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
              imageZoomed={imageZoomed}
              onImageZoomedChange={setImageZoomed}
              onCopyAbsolutePath={() => void copyToClipboard(`${repo}/${selectedPath}`)}
              onPreviewError={() => setPreviewError(true)}
              fileQuery={fileQuery}
              fontSize={settings.fontSize}
              mdMode={mdMode}
              scrollTop={
                selectedPath !== null ? fileScroll.get(selectedPath, scrollMode) : undefined
              }
              onScrollTopChange={(top) => {
                if (selectedPath !== null) fileScroll.set(selectedPath, scrollMode, top);
              }}
              selection={selection}
              onSelectedLinesChange={setSelection}
              onLineSelectionStart={() => setSelecting(true)}
              onLineSelectionEnd={() => setSelecting(false)}
              matches={anchoredMatches(matches)}
              composerLine={composerLine}
              askDisabled={!headKnown}
              onCancelComposer={cancelComposer}
              onOpenTargetDialog={openAskTargetDialog}
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
  imageZoomed,
  onImageZoomedChange,
  onCopyAbsolutePath,
  fileQuery,
  fontSize,
  mdMode,
  scrollTop,
  onScrollTopChange,
  selection,
  onSelectedLinesChange,
  onLineSelectionStart,
  onLineSelectionEnd,
  matches,
  composerLine,
  askDisabled,
  onCancelComposer,
  onOpenTargetDialog,
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
  imageZoomed: boolean;
  onImageZoomedChange: (zoomed: boolean) => void;
  onCopyAbsolutePath: () => void;
  fileQuery: ReturnType<typeof useFile>;
  fontSize: number;
  mdMode: "source" | "preview";
  scrollTop: number | undefined;
  onScrollTopChange: (top: number) => void;
  selection: CodeViewLineSelection | null;
  onSelectedLinesChange: (selection: CodeViewLineSelection | null) => void;
  onLineSelectionStart: () => void;
  onLineSelectionEnd: () => void;
  matches: ForFileMatch[];
  composerLine: number | null;
  askDisabled: boolean;
  onCancelComposer: () => void;
  onOpenTargetDialog: (body: string) => void | Promise<void>;
  onAskReply: (id: string, body: string) => void | Promise<void>;
  onAskResolve: (id: string) => void | Promise<void>;
  onAskResend: (id: string) => void | Promise<void>;
  onAskFocus: (id: string) => void | Promise<void>;
}) {
  if (selectedPath === null) {
    return <PanelState icon={FolderTree} title="ファイルを選択してください" />;
  }

  if (previewKind === "image" && rawUrl !== null) {
    if (previewError) {
      return (
        <PanelState icon={FileWarning} title="プレビューを読み込めませんでした" tone="error" />
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 overflow-auto bg-muted p-4">
        <img
          src={rawUrl}
          alt={selectedPath}
          data-zoomed={imageZoomed}
          className={cn(
            "cursor-zoom-in rounded-sm border border-border bg-background",
            imageZoomed ? "cursor-zoom-out max-w-none" : "max-h-full max-w-full object-contain",
          )}
          onClick={() => onImageZoomedChange(!imageZoomed)}
          onLoad={(e) => onImageLoad(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={onPreviewError}
        />
        <p className="text-xs text-muted-foreground">/api/fs/raw から直接表示 · クリックで実寸</p>
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
      <PanelState
        icon={FileQuestion}
        title="バイナリファイル"
        description="内容は表示しません。テキストでも 2 MiB を超えるファイルは同様に種別とサイズだけを表示します。"
        action={{ label: "絶対パスをコピー", onClick: onCopyAbsolutePath }}
      />
    );
  }

  if (data.kind === "too-large") {
    return (
      <PanelState
        icon={FileWarning}
        title={`${MAX_FILE_BYTES / (1024 * 1024)} MiB を超えています`}
        description={`${data.size} bytes`}
        action={{ label: "絶対パスをコピー", onClick: onCopyAbsolutePath }}
      />
    );
  }

  if (isMarkdownPath(data.path) && mdMode === "preview") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <MarkdownView
            key={data.path}
            contents={data.contents}
            scrollTop={scrollTop}
            onScrollTopChange={onScrollTopChange}
          />
        </div>
        <p className="shrink-0 border-t border-border px-2 py-1 text-xs text-muted-foreground">
          プレビューは読み取り専用。質問を付けるにはソース表示に切り替えて行を選択します。
        </p>
      </div>
    );
  }

  if (isHtmlPath(data.path) && mdMode === "preview") {
    return <HtmlFileView key={data.path} contents={data.contents} />;
  }

  const annotations = buildAskAnnotations(matches, composerLine);
  const renderAnnotation = (annotation: { metadata?: AskAnnotationMeta }) => {
    const meta = annotation.metadata;
    if (!meta) return null;
    if (meta.kind === "composer") {
      return (
        <AskComposer
          disabled={askDisabled}
          onCancel={onCancelComposer}
          onOpenTargetDialog={onOpenTargetDialog}
          path={selectedPath ?? undefined}
          startLine={selection ? Math.min(selection.range.start, selection.range.end) : undefined}
          endLine={selection ? Math.max(selection.range.start, selection.range.end) : undefined}
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
      scrollTop={scrollTop}
      onScrollTopChange={onScrollTopChange}
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
