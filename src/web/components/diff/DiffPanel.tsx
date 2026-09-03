// Composition root for the diff viewer (M3). Built fresh rather than ported
// from terminal-diff's App.tsx: that file also owned SSE, the "instance"
// concept, repo-select, quit and the notReady path, none of which exist
// here. DiffPanel does NOT own comparison state (`from`/`to`) — that's
// lifted to the parent ToolPane, which passes them down as props.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import type { CodeViewLineSelection, FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewDiffItem } from "@pierre/diffs/react";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import type { PatchResponse } from "@contract/git";
import type { ReviewTarget, Side } from "@contract/review";
import { buildAnchor } from "@/lib/anchor";
import { gitApi, reviewApi, type ForDiffMatch } from "@/lib/api";
import type { ReviewEvent } from "@/lib/herdrStore";
import { reviewEventMatchesRepo } from "@/lib/reviewEvent";
import { ComposerAnnotation, ReviewsAnnotation } from "@/components/review/ReviewAnnotation";
import { annotationSignature, withAnnotationRev } from "./annotationVersion";
import Banners from "./Banners.tsx";
import DiffView from "./DiffView.tsx";
import type { DiffViewHandle } from "./DiffView.tsx";
import FileTree from "./FileTree.tsx";
import { usePatch } from "./hooks/usePatch.ts";
import { reconcile, summarize } from "./reconcile.ts";
import type { FileMap } from "./reconcile.ts";
import {
  buildAnnotations,
  fromAnnotationSide,
  type ReviewAnnotationMeta,
} from "./reviewAnnotations.ts";
import { lineNumberToIndex, sideLines } from "./sideLines.ts";
import {
  DEFAULT_SETTINGS,
  initialBannerState,
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
  reduceBanner,
  updateBanner as deriveUpdateBanner,
  validateSettings,
} from "./state.ts";
import type { BannerState, Settings } from "./state.ts";
import StatusLine from "./StatusLine.tsx";
import { buildTree, fileStats, fileStatus } from "./tree.ts";
import Toolbar from "./Toolbar.tsx";

const FOR_DIFF_DEBOUNCE_MS = 200;

const SETTINGS_KEY = "herdr-web:diff-settings";
/** A scrollTop at or below this is "at the top" for auto-apply purposes. */
const NEAR_TOP_PX = 4;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return validateSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore — settings just won't persist across reloads
  }
}

function buildHashMap(files: PatchResponse["files"] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files ?? []) map.set(f.name, f.hash);
  return map;
}

function buildUntrackedMap(files: PatchResponse["files"] | undefined): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const f of files ?? []) map.set(f.name, !!f.untracked);
  return map;
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "SELECT" ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  );
}

/** Renders "WORKTREE vs HEAD" / "INDEX vs HEAD" / "<hash7> vs <hash7>" from the from/to props. */
export function comparisonLabel(from: string | undefined, to: string | undefined): string {
  const fromLabel = from ?? "HEAD";
  const toLabel = to ?? "WORKTREE";
  const shorten = (x: string) =>
    x === "HEAD" || x === "WORKTREE" || x === "INDEX" ? x : x.slice(0, 7);
  return `${shorten(toLabel)} vs ${shorten(fromLabel)}`;
}

/** Where the Review タブ asked DiffPanel to jump (plan.md F5-8). */
export interface DiffInitialLocation {
  path: string;
  line: number;
  side: Side;
}

export interface DiffPanelProps {
  repo: string;
  /** リポジトリキー（git-common-dir 絶対パス）。レビュー API の `repo`。null/未指定なら herdr 未接続などでまだ解決できていない。 */
  repoKey?: string | null;
  from?: string;
  to?: string;
  /** Bumped by the parent whenever this repo's git state is known to have changed. */
  repoChangedTick: number;
  /** F5-9: review / review-notify WS イベントを購読し、インライン表示を追従させる。 */
  subscribeReviewEvents?: (cb: (event: ReviewEvent) => void) => () => void;
  /** Review タブからのジャンプ先（F5-8）。一度消費したら親が null に戻す想定。 */
  initialLocation?: DiffInitialLocation | null;
  /** ジャンプ先に一度スクロールしたら呼ばれる。親はこれを受けて `initialLocation`
   * を null に戻すこと — さもないと、以降の poller 更新のたびに `items` が
   * 変わるたび同じ場所へ再スクロールしてしまう。 */
  onInitialLocationConsumed?: () => void;
}

export function DiffPanel({
  repo,
  repoKey = null,
  from,
  to,
  repoChangedTick,
  subscribeReviewEvents,
  initialLocation = null,
  onInitialLocationConsumed,
}: DiffPanelProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  useEffect(() => saveSettings(settings), [settings]);

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const treeWidth = dragWidth ?? settings.treeWidth;
  const handleTreeResize = useCallback((width: number) => setDragWidth(width), []);
  const handleTreeResizeEnd = useCallback((width: number) => {
    setDragWidth(null);
    setSettings((s) => ({ ...s, treeWidth: width }));
  }, []);

  const fileMapRef = useRef<FileMap>(new Map());
  const [items, setItems] = useState<CodeViewDiffItem[]>([]);
  const [parsedFiles, setParsedFiles] = useState<FileDiffMetadata[]>([]);
  const [untrackedByName, setUntrackedByName] = useState<Map<string, boolean>>(new Map());
  const [untrackedTruncated, setUntrackedTruncated] = useState(false);
  const [untrackedErrors, setUntrackedErrors] = useState(0);
  const [untrackedCount, setUntrackedCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // -------------------------------------------------------------------
  // Update-available banner state (state.ts's trimmed reducer) plus
  // scroll-position tracking, to decide auto-apply vs. banner.
  // -------------------------------------------------------------------
  const [bannerState, setBannerState] = useState<BannerState>(initialBannerState());
  const scrollTopRef = useRef(0);
  const handleScrollTopChange = useCallback((top: number) => {
    scrollTopRef.current = top;
  }, []);

  const applyPatchResponse = useCallback((data: PatchResponse) => {
    setGeneratedAt(data.generatedAt);
    setUntrackedByName(buildUntrackedMap(data.files));
    setUntrackedTruncated(!!data.untrackedTruncated);
    setUntrackedErrors(data.untrackedErrors ?? 0);

    const parsed = parsePatchFiles(data.patch, data.hash);
    const files = parsed[0]?.files ?? [];
    const hashes = buildHashMap(data.files);

    const { items: nextItems, next } = reconcile(fileMapRef.current, files, hashes);
    fileMapRef.current = next;
    setItems(nextItems);
    setParsedFiles(files);
    setUntrackedCount(data.untrackedCount ?? 0);

    setBannerState((s) => reduceBanner(s, { type: "applied", hash: data.hash }));
  }, []);

  const patchQuery = usePatch({ repo, from, to, repoChangedTick });

  const appliedHashRef = useRef<string | null>(null);
  // Mirrors `appliedHashRef.current === null` as state, for the one place
  // (deriving `errorText` below) that needs this during render — reading a
  // ref's `.current` during render is a react(refs) lint error, so that
  // check goes through state instead of the ref itself.
  const [hasEverApplied, setHasEverApplied] = useState(false);
  useEffect(() => {
    if (!patchQuery.isSuccess || !patchQuery.data) return;
    const data = patchQuery.data;
    if (appliedHashRef.current === data.hash) return;

    setBannerState((s) => reduceBanner(s, { type: "fetched", hash: data.hash }));

    const isEmpty = appliedHashRef.current === null || items.length === 0;
    const isNearTop = scrollTopRef.current <= NEAR_TOP_PX;
    if (isEmpty || isNearTop) {
      appliedHashRef.current = data.hash;
      setHasEverApplied(true);
      applyPatchResponse(data);
    }
  }, [patchQuery.isSuccess, patchQuery.data, applyPatchResponse, items.length]);

  const applyPending = useCallback(() => {
    const data = patchQuery.data;
    if (!data) return;
    appliedHashRef.current = data.hash;
    setHasEverApplied(true);
    applyPatchResponse(data);
  }, [patchQuery.data, applyPatchResponse]);

  // -------------------------------------------------------------------
  // File selection follows the rendered items. Adjusted during render
  // (React's documented pattern for "state that depends on a prop/derived
  // value changing"), not in an effect: an effect here would setState
  // synchronously on every `items` change and force an extra commit.
  // -------------------------------------------------------------------
  const [prevItemsForSelection, setPrevItemsForSelection] = useState(items);
  if (items !== prevItemsForSelection) {
    setPrevItemsForSelection(items);
    const next =
      items.length === 0
        ? null
        : selectedId && items.some((item) => item.id === selectedId)
          ? selectedId
          : items[0]!.id;
    if (next !== selectedId) setSelectedId(next);
  }

  const jumpToIndex = useCallback(
    (index: number) => {
      if (items.length === 0) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      const id = items[clamped]!.id;
      setSelectedId(id);
      diffViewRef.current?.scrollToItem(id);
    },
    [items],
  );

  const selectFile = useCallback((id: string) => {
    setSelectedId(id);
    diffViewRef.current?.scrollToItem(id);
  }, []);

  const handleTopItemChange = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? prev : id));
  }, []);

  // -------------------------------------------------------------------
  // Keyboard: j/k to move between files, r to apply a pending update.
  // -------------------------------------------------------------------
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    selectedIndexRef.current = items.findIndex((item) => item.id === selectedId);
  }, [items, selectedId]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j") {
        event.preventDefault();
        jumpToIndex(selectedIndexRef.current + 1);
      } else if (event.key === "k") {
        event.preventDefault();
        jumpToIndex(selectedIndexRef.current - 1);
      } else if (event.key === "r") {
        event.preventDefault();
        applyPending();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [jumpToIndex, applyPending]);

  // -------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------
  const banner = useMemo(() => deriveUpdateBanner(bannerState), [bannerState]);
  const errorText =
    patchQuery.isError && !hasEverApplied
      ? patchQuery.error instanceof Error
        ? patchQuery.error.message
        : String(patchQuery.error)
      : null;
  const summary = useMemo(() => summarize(parsedFiles), [parsedFiles]);
  const label = comparisonLabel(from, to);

  const treeNodes = useMemo(() => {
    const entries = items.map((item) => {
      const fileDiff = item.fileDiff;
      const untracked = !!untrackedByName.get(fileDiff.name);
      const stats = fileStats(fileDiff);
      return {
        id: item.id,
        name: fileDiff.name,
        status: fileStatus(fileDiff, untracked),
        additions: stats.additions,
        deletions: stats.deletions,
      };
    });
    return buildTree(entries);
  }, [items, untrackedByName]);

  // -------------------------------------------------------------------
  // F3-6 / F5: line-selection comment composer + inline review annotations.
  // -------------------------------------------------------------------
  const target: ReviewTarget = useMemo(() => {
    const toResolved = to ?? "WORKTREE";
    return toResolved === "WORKTREE" || toResolved === "INDEX"
      ? { kind: "worktree", root: repo }
      : { kind: "commit", hash: toResolved };
  }, [repo, to]);

  // createdAtHead (plan §F5-1) — fetched once per repo/tick, best-effort.
  // `headKnown` mirrors `headRef.current !== null` as state (same pattern as
  // `hasEverApplied` above) so the composer can disable submit rather than
  // send `createdAtHead: ""` while this is still in flight.
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
    // repoChangedTick isn't read in the body but intentionally forces a
    // re-fetch when the repo's git state moves (same tick pattern usePatch.ts uses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, repoChangedTick]);

  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const [matchesByPath, setMatchesByPath] = useState<Map<string, ForDiffMatch[]>>(new Map());

  // `repo`/`from`/`to` changes remount this whole component (ToolPane keys
  // DiffPanel on them), but `repoKey` can also resolve/change on its own
  // (e.g. from null while herdr is still connecting) without a remount —
  // drop stale inline review annotations rather than showing the wrong
  // worktree/commit's threads until refreshMatches() catches up.
  useEffect(() => {
    setMatchesByPath(new Map());
  }, [repoKey]);

  const forDiffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshMatches = useCallback(() => {
    if (forDiffTimerRef.current) clearTimeout(forDiffTimerRef.current);
    forDiffTimerRef.current = setTimeout(() => {
      if (!repoKey) return;
      const fromResolved = from ?? "HEAD";
      const toResolved = to ?? "WORKTREE";
      for (const file of parsedFiles) {
        void reviewApi
          .forDiff({
            repo: repoKey,
            worktreeRoot: repo,
            from: fromResolved,
            to: toResolved,
            path: file.name,
            sideLines: sideLines(file),
          })
          .then((matches) => {
            setMatchesByPath((prev) => {
              const next = new Map(prev);
              next.set(file.name, matches);
              return next;
            });
          })
          .catch(() => {
            // インライン表示は best-effort。失敗しても diff 自体は読める。
          });
      }
    }, FOR_DIFF_DEBOUNCE_MS);
  }, [repoKey, repo, from, to, parsedFiles]);

  useEffect(() => {
    refreshMatches();
    return () => {
      if (forDiffTimerRef.current) clearTimeout(forDiffTimerRef.current);
    };
  }, [refreshMatches]);

  // F5-9: review / review-notify WS イベントで再フェッチする。ペイロードは
  // contract/events.ts では `v.unknown()`（review モジュールの型を web から
  // import できないため opaque）なので `reviewEventMatchesRepo` で防御的に
  // repo を読み取り、他リポジトリ向けのイベントでの再フェッチは間引く
  // （repo を判別できないイベント — review-notify 等 — は素通しする）。
  // refreshMatches 自体が forDiffTimerRef で 1 つのタイマーにデバウンスして
  // いるため、patch 変化とイベント発火をまたいでも 200ms に 1 回にまとまる。
  useEffect(() => {
    if (!subscribeReviewEvents) return;
    return subscribeReviewEvents((event) => {
      if (reviewEventMatchesRepo(event, repoKey)) refreshMatches();
    });
  }, [subscribeReviewEvents, refreshMatches, repoKey]);

  const composerTarget = useMemo(() => {
    if (!selection) return null;
    const side: Side = selection.range.side ? fromAnnotationSide(selection.range.side) : "new";
    return { id: selection.id, side, lineNumber: selection.range.start };
  }, [selection]);

  const cancelComposer = useCallback(() => setSelection(null), []);

  const submitComposer = useCallback(
    async (body: string) => {
      if (!composerTarget || !repoKey) {
        showToast("レビューを作成できません（リポジトリを解決できていません）");
        return;
      }
      const item = items.find((i) => i.id === composerTarget.id);
      if (!item) return;
      const fileDiff = item.fileDiff;
      const lines = sideLines(fileDiff)[composerTarget.side];
      const index0 = lineNumberToIndex(fileDiff, composerTarget.side, composerTarget.lineNumber);
      if (index0 === null) {
        showToast("行を特定できませんでした");
        return;
      }
      try {
        const anchor = await buildAnchor(lines, index0, composerTarget.side);
        await reviewApi.create({
          repo: repoKey,
          worktreeRoot: repo,
          target,
          path: fileDiff.name,
          anchor,
          createdAtHead: headRef.current ?? "",
          viewedAs: { from: from ?? "HEAD", to: to ?? "WORKTREE" },
          body,
        });
        setSelection(null);
        refreshMatches();
      } catch {
        showToast("コメントの投稿に失敗しました");
      }
    },
    [composerTarget, repoKey, items, repo, target, from, to, refreshMatches, showToast],
  );

  const handleReply = useCallback(
    async (id: string, body: string) => {
      try {
        await reviewApi.reply(id, { body, author: "user" });
        refreshMatches();
      } catch {
        showToast("返信に失敗しました");
      }
    },
    [refreshMatches, showToast],
  );

  const handleResolve = useCallback(
    async (id: string) => {
      try {
        await reviewApi.resolve(id);
        refreshMatches();
      } catch {
        showToast("解決に失敗しました");
      }
    },
    [refreshMatches, showToast],
  );

  const handleReanchor = useCallback(
    async (id: string) => {
      try {
        await reviewApi.reanchor(id);
        refreshMatches();
      } catch {
        showToast("再アンカーに失敗しました");
      }
    },
    [refreshMatches, showToast],
  );

  const handleResend = useCallback(
    async (id: string) => {
      try {
        await reviewApi.notify(id);
        refreshMatches();
      } catch {
        showToast("再送に失敗しました");
      }
    },
    [refreshMatches, showToast],
  );

  // CodeView（@pierre/diffs/react）は item の `id:version` が変わったときしか
  // annotation のポータルを作り直さない。annotation の集合が変わったら version を
  // 上げないと、コンポーザーもレビュースレッドも画面に出ない。
  const annotationRevs = useRef(new Map<string, { sig: string; rev: number }>());
  const itemsWithAnnotations = useMemo<CodeViewDiffItem<ReviewAnnotationMeta>[]>(() => {
    return items.map((item) => {
      const matches = matchesByPath.get(item.fileDiff.name) ?? [];
      const composer =
        composerTarget && composerTarget.id === item.id
          ? { side: composerTarget.side, lineNumber: composerTarget.lineNumber }
          : null;
      const annotations = buildAnnotations(item.fileDiff, matches, composer);
      const sig = annotationSignature(annotations);
      const prev = annotationRevs.current.get(item.id);
      const rev = prev === undefined ? 0 : prev.sig === sig ? prev.rev : prev.rev + 1;
      annotationRevs.current.set(item.id, { sig, rev });
      return { ...item, version: withAnnotationRev(item.version ?? 0, rev), annotations };
    });
  }, [items, matchesByPath, composerTarget]);

  const renderAnnotation = useCallback(
    (annotation: { metadata?: ReviewAnnotationMeta }) => {
      const meta = annotation.metadata;
      if (!meta) return null;
      if (meta.kind === "composer") {
        return (
          <ComposerAnnotation
            onCancel={cancelComposer}
            onSubmit={submitComposer}
            disabled={!headKnown}
          />
        );
      }
      return (
        <ReviewsAnnotation
          matches={meta.matches}
          onReply={handleReply}
          onResolve={handleResolve}
          onReanchor={handleReanchor}
          onResend={handleResend}
        />
      );
    },
    [
      cancelComposer,
      submitComposer,
      headKnown,
      handleReply,
      handleResolve,
      handleReanchor,
      handleResend,
    ],
  );

  // F5-8: Review タブから該当ファイル/行へジャンプする。selectedId は
  // 「prop/derived value の変化に反応して state を調整する」React 公式パターン
  // で render 中に合わせ込み（selectFile 等と同じ発想）、DiffView への命令的
  // scroll だけを effect に残す — effect 内で直接 setState すると
  // react(set-state-in-effect) に引っかかるため。
  const [prevInitialLocation, setPrevInitialLocation] = useState(initialLocation);
  if (initialLocation !== prevInitialLocation) {
    setPrevInitialLocation(initialLocation);
    if (initialLocation) {
      const item = items.find((i) => i.fileDiff.name === initialLocation.path);
      if (item && item.id !== selectedId) setSelectedId(item.id);
    }
  }

  useEffect(() => {
    if (!initialLocation) return;
    const item = items.find((i) => i.fileDiff.name === initialLocation.path);
    if (!item) return;
    diffViewRef.current?.scrollToItem(item.id);
    diffViewRef.current?.scrollToLine(
      item.id,
      initialLocation.line,
      initialLocation.side === "old" ? "deletions" : "additions",
    );
    onInitialLocationConsumed?.();
  }, [initialLocation, items, onInitialLocationConsumed]);

  return (
    <div id="diff-panel" className="flex h-full min-h-0 flex-col">
      <Toolbar
        settings={settings}
        onToggleTree={() => setSettings((s) => ({ ...s, showTree: !s.showTree }))}
        onToggleDiffStyle={() =>
          setSettings((s) => ({ ...s, diffStyle: s.diffStyle === "split" ? "unified" : "split" }))
        }
        onToggleOverflow={() =>
          setSettings((s) => ({ ...s, overflow: s.overflow === "wrap" ? "scroll" : "wrap" }))
        }
        onFontDec={() => setSettings((s) => ({ ...s, fontSize: Math.max(10, s.fontSize - 1) }))}
        onFontInc={() => setSettings((s) => ({ ...s, fontSize: Math.min(24, s.fontSize + 1) }))}
        onRefresh={applyPending}
        disabled={false}
      />
      <div className="border-b border-border px-2 py-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex min-h-0 flex-1">
        {settings.showTree && (
          <>
            <FileTree
              nodes={treeNodes}
              activeId={selectedId}
              onSelect={selectFile}
              collapsed={collapsedDirs}
              onToggleDir={toggleDir}
              width={treeWidth}
            />
            <ResizeHandle
              width={treeWidth}
              min={MIN_TREE_WIDTH}
              max={MAX_TREE_WIDTH}
              defaultWidth={DEFAULT_SETTINGS.treeWidth}
              onResize={handleTreeResize}
              onResizeEnd={handleTreeResizeEnd}
            />
          </>
        )}
        <div id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Banners
            updateBanner={banner}
            errorText={errorText}
            untrackedTruncated={untrackedTruncated}
            onUpdate={applyPending}
          />
          <StatusLine
            summary={summary}
            generatedAt={generatedAt}
            untrackedCount={untrackedCount}
            untrackedErrors={untrackedErrors}
          />
          <div className="min-h-0 flex-1">
            <DiffView
              ref={diffViewRef}
              items={itemsWithAnnotations}
              settings={settings}
              repo={repo}
              onToast={showToast}
              onTopItemChange={handleTopItemChange}
              onScrollTopChange={handleScrollTopChange}
              selectedLines={selection}
              onSelectedLinesChange={setSelection}
              renderAnnotation={renderAnnotation}
            />
          </div>
        </div>
      </div>
      {toast != null && (
        <div
          id="toast"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default DiffPanel;
