import { useEffect, useMemo, useReducer, useState } from "react";
import type { VirtualizerOptions } from "@tanstack/react-virtual";
import type { Ref } from "@contract/git";
import { useGraph } from "./hooks/useGraph";
import { initialState, reduce } from "./state";
import GraphView from "./GraphView";

export interface GraphPanelProps {
  repo: string;
  repoChangedTick: number;
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
  onSelectCommit,
  onOpenDiff,
  virtualizerOptions,
}: GraphPanelProps) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState());
  // Anchor commit for a pending shift-click range (the most recent plain click).
  const [anchorHash, setAnchorHash] = useState<string | null>(null);

  const graphQuery = useGraph(repo, true, 500, repoChangedTick);

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
    >
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
