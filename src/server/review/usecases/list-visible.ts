import { ResultAsync } from "neverthrow";
import type { Review, ReviewStatus } from "../../../contract/review";
import type { GitHistory, ListFilter, ReviewRepository } from "../ports";

export type ListVisibleOpts = {
  all?: boolean;
  commit?: string;
  since?: string;
  uncommitted?: boolean;
  unreachable?: boolean;
  path?: string;
};

export type ListVisibleInput = {
  repo: string;
  worktreeRoot: string;
  opts?: ListVisibleOpts;
};

export type ListVisibleDeps = {
  repository: ReviewRepository;
  gitHistory: GitHistory;
};

const DEFAULT_STATUSES: ReviewStatus[] = ["open", "replied"];
const ALL_STATUSES: ReviewStatus[] = ["open", "replied", "resolved", "outdated"];

/**
 * plan §6.5 の可視性: worktree に付いた未コミットのレビュー、および
 * commit 確定済みで worktree の HEAD から到達可能なレビューのうち open/replied を返す。
 * オプションで挙動を変える: all / commit / since / uncommitted / unreachable。
 */
export function listVisibleUsecase(deps: ListVisibleDeps) {
  return function listVisibleFn(input: ListVisibleInput): ResultAsync<Review[], never> {
    return ResultAsync.fromSafePromise(
      (async () => {
        const opts = input.opts ?? {};
        const statuses = opts.all ? ALL_STATUSES : DEFAULT_STATUSES;
        const baseFilter: ListFilter = { repo: input.repo, status: statuses, path: opts.path };

        if (opts.uncommitted) {
          return deps.repository.list({
            ...baseFilter,
            targetKind: "worktree",
            worktreeRoot: input.worktreeRoot,
          });
        }

        if (opts.unreachable) {
          const commitReviews = await deps.repository.list({ ...baseFilter, targetKind: "commit" });
          const head = await deps.gitHistory.headOf(input.worktreeRoot);
          if (!head) return commitReviews;
          const results: Review[] = [];
          for (const review of commitReviews) {
            if (review.target.kind !== "commit") continue;
            const reachable = await deps.gitHistory.isAncestor(
              input.worktreeRoot,
              review.target.hash,
              head,
            );
            if (!reachable) results.push(review);
          }
          return results;
        }

        if (opts.commit) {
          return deps.repository.list({ ...baseFilter, targetKind: "commit", commit: opts.commit });
        }

        const worktreeReviews = await deps.repository.list({
          ...baseFilter,
          targetKind: "worktree",
          worktreeRoot: input.worktreeRoot,
        });

        const commitReviews = await deps.repository.list({ ...baseFilter, targetKind: "commit" });
        const head = await deps.gitHistory.headOf(input.worktreeRoot);
        const reachableCommitReviews: Review[] = [];
        if (head) {
          let sinceRange: string[] | null = null;
          if (opts.since) {
            sinceRange = await deps.gitHistory.revRange(input.worktreeRoot, opts.since, head);
          }
          for (const review of commitReviews) {
            if (review.target.kind !== "commit") continue;
            const visible = sinceRange
              ? sinceRange.includes(review.target.hash)
              : await deps.gitHistory.isAncestor(input.worktreeRoot, review.target.hash, head);
            if (visible) reachableCommitReviews.push(review);
          }
        }

        return [...worktreeReviews, ...reachableCommitReviews];
      })(),
    );
  };
}
