import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { Review, ReviewStatus } from "../../../contract/review";
import { domainError, type DomainError } from "../domain/errors";
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
export type ListVisibleUsecase = ReturnType<typeof listVisibleUsecase>;

export function listVisibleUsecase(deps: ListVisibleDeps) {
  return function listVisibleFn(input: ListVisibleInput): ResultAsync<Review[], DomainError> {
    return ResultAsync.fromSafePromise(
      (async (): Promise<Result<Review[], DomainError>> => {
        const opts = input.opts ?? {};
        const statuses = opts.all ? ALL_STATUSES : DEFAULT_STATUSES;
        const baseFilter: ListFilter = { repo: input.repo, status: statuses, path: opts.path };

        // F9: cache isAncestor(hash, head) per request — N reviews sharing a
        // commit spawn `git merge-base --is-ancestor` once, not N times.
        const ancestorCache = new Map<string, boolean>();
        async function isAncestorCached(hash: string, head: string): Promise<boolean> {
          const key = `${hash}:${head}`;
          if (ancestorCache.has(key)) return ancestorCache.get(key)!;
          const result = await deps.gitHistory.isAncestor(input.worktreeRoot, hash, head);
          ancestorCache.set(key, result);
          return result;
        }

        if (opts.uncommitted) {
          return ok(
            await deps.repository.list({
              ...baseFilter,
              targetKind: "worktree",
              worktreeRoot: input.worktreeRoot,
            }),
          );
        }

        if (opts.unreachable) {
          const commitReviews = await deps.repository.list({ ...baseFilter, targetKind: "commit" });
          const head = await deps.gitHistory.headOf(input.worktreeRoot);
          if (!head) return ok(commitReviews); // F6: missing worktree -> worktree-bound only elsewhere
          const results: Review[] = [];
          for (const review of commitReviews) {
            if (review.target.kind !== "commit") continue;
            const reachable = await isAncestorCached(review.target.hash, head);
            if (!reachable) results.push(review);
          }
          return ok(results);
        }

        if (opts.commit) {
          return ok(
            await deps.repository.list({
              ...baseFilter,
              targetKind: "commit",
              commit: opts.commit,
            }),
          );
        }

        const worktreeReviews = await deps.repository.list({
          ...baseFilter,
          targetKind: "worktree",
          worktreeRoot: input.worktreeRoot,
        });

        const commitReviews = await deps.repository.list({ ...baseFilter, targetKind: "commit" });
        // F6: headOf resolves null (not reject) when the worktree root is gone — in that
        // case commitReviews stay unvisited, so only worktree-bound reviews come back.
        const head = await deps.gitHistory.headOf(input.worktreeRoot);
        const reachableCommitReviews: Review[] = [];
        if (head) {
          let sinceRange: string[] | null = null;
          if (opts.since) {
            // F9: `since` is inclusive of the commit itself — `since~1..head` includes it,
            // where plain `since..head` would exclude it. If `since~1` doesn't resolve
            // (e.g. `since` is the repo's root commit, or not a valid rev at all), fall
            // back to a direct rev-range probe of `since` itself so the root-commit case
            // still works; a genuinely invalid rev then surfaces as invalid_rev.
            let range = await deps.gitHistory.revRange(input.worktreeRoot, `${opts.since}~1`, head);
            if (range === null) {
              range = await deps.gitHistory.revRange(input.worktreeRoot, opts.since, head);
              if (range === null) {
                return err(domainError("invalid_rev", `invalid since rev: ${opts.since}`));
              }
              range = [...range, opts.since];
            }
            sinceRange = range;
          }
          for (const review of commitReviews) {
            if (review.target.kind !== "commit") continue;
            const visible = sinceRange
              ? sinceRange.includes(review.target.hash)
              : await isAncestorCached(review.target.hash, head);
            if (visible) reachableCommitReviews.push(review);
          }
        }

        return ok([...worktreeReviews, ...reachableCommitReviews]);
      })(),
    ).andThen((r) => r);
  };
}
