import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { VirtualizerOptions } from "@tanstack/react-virtual";
import { RefreshCw } from "lucide-react";
import type { Ref } from "@contract/git";
import { FetchBusyError, gitApi } from "@/lib/api";
import { useGraph } from "./hooks/useGraph";
import { initialState, reduce } from "./state";
import GraphView from "./GraphView";

/** How long the fetch result line stays visible before auto-dismissing. */
const FETCH_MESSAGE_TIMEOUT_MS = 5000;

export interface GraphPanelProps {
  repo: string;
  repoChangedTick: number;
  /** See usePatch's `pollMs` (useGraph mirrors it): a client-side refetch
   * interval for repos that don't get their own `repoChangedTick` (a
   * sub-repo/submodule selection). */
  pollMs?: number;
  onSelectCommit(range: { from: string; to: string } | null): void;
  /** 「diff を見る」/ ダブルクリック: 親との diff を選択して Diff タブへ遷移させる */
  onOpenDiff?(range: { from: string; to: string }): void;
  /**
   * Test-only escape hatch, threaded down to GraphView (react-virtual needs
   * a real ResizeObserver to size itself; jsdom has none).
   */
  virtualizerOptions?: Partial<VirtualizerOptions<HTMLDivElement, Element>>;
}

const ROOT_COMMIT_NOTE = "ルートコミットの diff は表示できません";

/**
 * Composition root for the git graph module (F4). Fetches the commit graph
 * for `repo`, renders it via `GraphView`, and turns commit selection into a
 * `{ from, to }` diff range for the caller (which wires it into `DiffPanel`):
 *
 *  - Click a commit: selects it. If it has a first parent, the range is
 *    `{ from: parents[0], to: hash }`. A root commit (no parents) has no
 *    valid `from` — the server's `/api/git/patch` resolves commit-ishes via
 *    `git rev-parse "<x>^{commit}"`, which would reject a fabricated
 *    empty-tree sha (that's a tree object, not a commit) — so for a root
 *    commit we do NOT call `onSelectCommit` with a range; we call it with
 *    `null` and show an inline note in the expanded `CommitDetail` instead.
 *  - Shift-click a second commit while one is already selected: range
 *    selection between the two, ordered using the graph's own topological
 *    (newest-first) ordering rather than wall-clock `commitDate` — tgg's
 *    graph already lists commits newest-first, so "earlier in `commits`" =
 *    newer. `{ from: olderCommit.hash, to: newerCommit.hash }`.
 *  - Shift-click with nothing selected yet, or shift-click the same commit
 *    again, behaves like a plain click (selects just that one commit).
 */
export function GraphPanel({
  repo,
  repoChangedTick,
  pollMs,
  onSelectCommit,
  onOpenDiff,
  virtualizerOptions,
}: GraphPanelProps) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState());
  // Anchor commit for a pending shift-click range (the most recent plain click).
  const [anchorHash, setAnchorHash] = useState<string | null>(null);

  const graphQuery = useGraph(repo, true, 500, repoChangedTick, pollMs);

  // -----------------------------------------------------------------------
  // fetch (git fetch --prune) — plan.md §4: read-only writes to
  // refs/remotes/* only, no pull/merge/checkout. Never mutates the worktree.
  // -----------------------------------------------------------------------
  const [fetchBusy, setFetchBusy] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const fetchMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (fetchMessageTimer.current !== null) clearTimeout(fetchMessageTimer.current);
    },
    [],
  );

  const showFetchMessage = useCallback((message: string) => {
    setFetchMessage(message);
    if (fetchMessageTimer.current !== null) clearTimeout(fetchMessageTimer.current);
    fetchMessageTimer.current = setTimeout(() => {
      setFetchMessage(null);
      fetchMessageTimer.current = null;
    }, FETCH_MESSAGE_TIMEOUT_MS);
  }, []);

  const handleFetch = useCallback(async () => {
    if (fetchBusy) return;
    setFetchBusy(true);
    try {
      const result = await gitApi.fetch(repo);
      if (result.timedOut) {
        showFetchMessage("タイムアウト");
      } else if (result.code === 0) {
        const seconds = (result.durationMs / 1000).toFixed(1);
        const summary = result.stderr.trim().split("\n")[0];
        showFetchMessage(
          summary ? `fetch 完了 (${seconds}s) — ${summary}` : `fetch 完了 (${seconds}s)`,
        );
        void graphQuery.refetch();
      } else {
        const firstLine = result.stderr.trim().split("\n")[0];
        showFetchMessage(firstLine || `fetch に失敗しました (exit ${result.code})`);
      }
    } catch (err) {
      if (err instanceof FetchBusyError) {
        showFetchMessage("実行中です");
      } else {
        showFetchMessage(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setFetchBusy(false);
    }
  }, [fetchBusy, repo, graphQuery, showFetchMessage]);

  function handleGraphKeyDown(event: React.KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "f") {
      event.preventDefault();
      void handleFetch();
    }
  }

  const graphData = graphQuery.data;
  // `?? []` would otherwise produce a fresh array reference on every render
  // while data is undefined, defeating downstream useMemo dependency checks.
  const commits = useMemo(() => graphData?.commits ?? [], [graphData]);
  const refs = useMemo(() => graphData?.refs ?? [], [graphData]);
  const headHash = graphData?.head.hash ?? null;

  const refsByHash = useMemo(() => {
    const map = new Map<string, Ref[]>();
    for (const r of refs) {
      const list = map.get(r.hash);
      if (list) list.push(r);
      else map.set(r.hash, [r]);
    }
    return map;
  }, [refs]);

  // Repo switched out from under us: clear selection state and any
  // previously-reported diff range, which is meaningless for the new repo.
  useEffect(() => {
    dispatch({ type: "selectHash", hash: null });
    setAnchorHash(null);
    onSelectCommit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === state.selectedHash) ?? null,
    [commits, state.selectedHash],
  );

  const detailNote =
    selectedCommit && selectedCommit.parents.length === 0 ? ROOT_COMMIT_NOTE : undefined;

  function handleSelect(hash: string, event: { shiftKey: boolean }) {
    const clickedIndex = commits.findIndex((c) => c.hash === hash);
    const clickedCommit = clickedIndex >= 0 ? commits[clickedIndex] : undefined;

    if (event.shiftKey && anchorHash && anchorHash !== hash) {
      const anchorIndex = commits.findIndex((c) => c.hash === anchorHash);
      if (anchorIndex >= 0 && clickedIndex >= 0) {
        // Commits are listed newest-first (topological order from the
        // server); the smaller index is the newer commit.
        const newer = (anchorIndex <= clickedIndex ? commits[anchorIndex] : commits[clickedIndex])!;
        const older = (anchorIndex <= clickedIndex ? commits[clickedIndex] : commits[anchorIndex])!;
        dispatch({ type: "selectHash", hash, openDetail: false });
        setAnchorHash(hash);
        onSelectCommit({ from: older.hash, to: newer.hash });
        return;
      }
    }

    // 選択中のコミットをもう一度クリックしたら詳細を閉じる（閉じるボタンは置かない）。
    if (state.selectedHash === hash && state.detailOpen) {
      dispatch({ type: "toggleDetail" });
      return;
    }

    // Plain click (or shift-click with no usable anchor): select this
    // commit alone and open its inline detail.
    dispatch({ type: "selectHash", hash, openDetail: true });
    setAnchorHash(hash);

    if (!clickedCommit) {
      onSelectCommit(null);
      return;
    }
    if (clickedCommit.parents.length === 0) {
      // Root commit: no valid `from` to diff against.
      onSelectCommit(null);
      return;
    }
    onSelectCommit({ from: clickedCommit.parents[0]!, to: clickedCommit.hash });
  }

  function handleCloseDetail() {
    dispatch({ type: "closeDetail" });
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace' }}
      tabIndex={-1}
      onKeyDown={handleGraphKeyDown}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1 text-xs">
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="origin を fetch"
          disabled={fetchBusy}
          onClick={() => void handleFetch()}
        >
          <RefreshCw className={`size-3.5 ${fetchBusy ? "animate-spin" : ""}`} aria-hidden="true" />
          fetch
        </button>
        {fetchMessage && (
          <span className="truncate text-muted-foreground" role="status">
            {fetchMessage}
          </span>
        )}
      </div>
      {graphQuery.isError ? (
        <div className="p-2 text-sm text-destructive" role="alert">
          {graphQuery.error instanceof Error ? graphQuery.error.message : String(graphQuery.error)}
        </div>
      ) : graphQuery.isLoading ? (
        <div className="p-2 text-sm text-muted-foreground">読み込み中…</div>
      ) : (
        <GraphView
          commits={commits}
          refsByHash={refsByHash}
          headHash={headHash}
          selectedHash={state.selectedHash}
          detailOpen={state.detailOpen}
          repo={repo}
          detailNote={detailNote}
          onSelect={handleSelect}
          onCloseDetail={handleCloseDetail}
          onOpenDiff={(hash) => {
            const c = commits.find((x) => x.hash === hash);
            if (c && c.parents[0]) onOpenDiff?.({ from: c.parents[0], to: c.hash });
          }}
          virtualizerOptions={virtualizerOptions}
        />
      )}
    </div>
  );
}
