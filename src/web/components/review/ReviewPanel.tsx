// The `Review` タブ (plan.md F5-8): lists every review visible for the
// current repo/worktree, filters by status / target kind / path, and lets
// clicking a row jump ToolPane to the right diff comparison + location.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Review, ReviewStatus } from "@contract/review";
import { gitApi } from "@/lib/api";
import type { ReviewEvent } from "@/lib/herdrStore";
import { reviewEventMatchesRepo } from "@/lib/reviewEvent";
import { Button } from "@/components/ui/button";
import type { DiffInitialLocation } from "@/components/diff/DiffPanel";
import { useReviewList } from "./hooks/useReviewList";

export type ReviewNavigation =
  | { comparison: { from: string; to: string } | null; location: DiffInitialLocation }
  /** A commit-target review whose commit has no parent (`${hash}^` doesn't
   * resolve — see src/server/git/patch.ts's `assertCommitish`, and there's no
   * client-facing way to request a diff against the empty tree for an
   * arbitrary commit). There's no valid Diff view for it, so route to the
   * Graph tab instead of navigating into a comparison the patch API rejects. */
  | { routeToGraph: true };

export interface ReviewPanelProps {
  repoKey: string | null;
  worktreeRoot: string;
  subscribeReviewEvents?: (cb: (event: ReviewEvent) => void) => () => void;
  onNavigate: (nav: ReviewNavigation) => void;
}

const ALL_STATUSES: ReviewStatus[] = ["open", "replied", "resolved", "outdated"];

const STATUS_LABEL: Record<ReviewStatus, string> = {
  open: "open",
  replied: "replied",
  resolved: "resolved",
  outdated: "outdated",
};

function reviewNavigation(review: Review): ReviewNavigation {
  const comparison =
    review.target.kind === "commit"
      ? { from: `${review.target.hash}^`, to: review.target.hash }
      : null;
  return {
    comparison,
    location: { path: review.path, line: review.anchor.lineHint, side: review.anchor.side },
  };
}

/** True if `hash` has no parent (a root commit) — `${hash}^` won't resolve
 * for it. Best-effort: a lookup failure is treated as "not a root commit" so
 * navigation still proceeds to the (possibly erroring) Diff tab rather than
 * silently doing nothing. */
async function isRootCommit(repoKey: string, hash: string): Promise<boolean> {
  try {
    const detail = await gitApi.commit({ repo: repoKey, hash });
    return detail.parents.length === 0;
  } catch {
    return false;
  }
}

export function ReviewPanel({
  repoKey,
  worktreeRoot,
  subscribeReviewEvents,
  onNavigate,
}: ReviewPanelProps) {
  const [tick, setTick] = useState(0);
  const [showUnreachable, setShowUnreachable] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<ReviewStatus>>(
    new Set(["open", "replied", "outdated"]),
  );
  const [targetFilter, setTargetFilter] = useState<"all" | "worktree" | "commit">("all");
  const [pathFilter, setPathFilter] = useState("");

  const query = useReviewList(
    repoKey
      ? { repo: repoKey, worktree: worktreeRoot, all: true, unreachable: showUnreachable }
      : null,
    tick,
  );
  const reviews = useMemo<Review[]>(() => query.data ?? [], [query.data]);
  const loading = query.isLoading;

  // F5-9: review / review-notify WS イベントで再フェッチする（外部イベントへの
  // 応答としての setState — effect 実行時に直接ではなく購読コールバック内で呼ぶ）。
  useEffect(() => {
    if (!subscribeReviewEvents) return;
    return subscribeReviewEvents((event) => {
      if (reviewEventMatchesRepo(event, repoKey)) setTick((t) => t + 1);
    });
  }, [subscribeReviewEvents, repoKey]);

  const handleClickReview = useCallback(
    async (review: Review) => {
      if (
        repoKey &&
        review.target.kind === "commit" &&
        (await isRootCommit(repoKey, review.target.hash))
      ) {
        onNavigate({ routeToGraph: true });
        return;
      }
      onNavigate(reviewNavigation(review));
    },
    [repoKey, onNavigate],
  );

  const toggleStatus = useCallback((status: ReviewStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    return reviews
      .filter((r) => statusFilter.has(r.status))
      .filter((r) => targetFilter === "all" || r.target.kind === targetFilter)
      .filter((r) => !pathFilter.trim() || r.path.includes(pathFilter.trim()))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }, [reviews, statusFilter, targetFilter, pathFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-2 text-xs">
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={statusFilter.has(status)}
                onChange={() => toggleStatus(status)}
              />
              {STATUS_LABEL[status]}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="target"
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value as "all" | "worktree" | "commit")}
            className="rounded border border-border bg-background px-1 py-0.5"
          >
            <option value="all">all targets</option>
            <option value="worktree">worktree</option>
            <option value="commit">commit</option>
          </select>
          <input
            type="text"
            placeholder="path"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5"
          />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showUnreachable}
              onChange={(e) => setShowUnreachable(e.target.checked)}
            />
            unreachable
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!repoKey && (
          <p className="p-2 text-xs text-muted-foreground">リポジトリを解決できていません。</p>
        )}
        {repoKey && loading && filtered.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">読み込み中…</p>
        )}
        {repoKey && !loading && filtered.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">レビューはありません。</p>
        )}
        <ul>
          {filtered.map((review) => (
            <li key={review.id} className="border-b border-border">
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full flex-col items-start gap-0.5 rounded-none px-2 py-1.5 text-left"
                onClick={() => void handleClickReview(review)}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">
                    {review.status}
                  </span>
                  <span className="truncate text-xs">{review.path}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {review.target.kind}
                  </span>
                </div>
                <p className="w-full truncate text-xs text-muted-foreground">
                  {review.thread[0]?.body ?? ""}
                </p>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ReviewPanel;
