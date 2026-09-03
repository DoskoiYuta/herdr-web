import { errAsync, ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import {
  markOutdated,
  reanchorToCommit,
  reopenFromOutdated,
  retargetCommit,
} from "../domain/transitions";
import { anchorGone } from "./reanchor-after-change";
import type {
  Clock,
  GitHistory,
  IntroducingCommitFinder,
  ReviewEvents,
  ReviewRepository,
  WorktreeFileReader,
} from "../ports";
import { notFound, type UsecaseError } from "./errors";

export type ReanchorReviewDeps = {
  repository: ReviewRepository;
  fileReader: WorktreeFileReader;
  finder: IntroducingCommitFinder;
  gitHistory: GitHistory;
  clock: Clock;
  events: ReviewEvents;
};

export type ReanchorReviewInput = { id: string; head?: string };

/** POST /api/review/:id/reanchor 用の、単一レビューだけを対象にした手動再アンカー */
export function reanchorReviewUsecase(deps: ReanchorReviewDeps) {
  return function reanchorReviewFn(input: ReanchorReviewInput): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(deps.repository.get(input.id)).andThen((review) => {
      if (!review) return errAsync(notFound(`review ${input.id} not found`));

      return ResultAsync.fromSafePromise(
        (async () => {
          if (review.target.kind === "worktree") {
            const head =
              input.head ??
              (await deps.gitHistory.headOf(review.worktreeRoot)) ??
              review.createdAtHead;
            const lines = await deps.fileReader.readLines(review.worktreeRoot, review.path);
            let next: Review | null = null;

            if (anchorGone(review, lines)) {
              const r = markOutdated(review, deps.clock);
              if (r.isOk()) next = r.value;
            } else {
              let current = review;
              if (current.status === "outdated") {
                // 行が戻っている（または削除が再び有効）なら user の再アンカー成功として open に戻す
                const r = reopenFromOutdated(current, deps.clock);
                if (r.isOk()) {
                  current = r.value;
                  next = current;
                }
              }
              if (head !== review.createdAtHead) {
                const commit = await deps.finder.find(
                  review.worktreeRoot,
                  review,
                  review.createdAtHead,
                );
                if (commit) {
                  const r = reanchorToCommit(current, commit, deps.clock);
                  if (r.isOk()) next = r.value;
                }
              }
            }

            if (next) {
              await deps.repository.save(next);
              deps.events.emit({
                type: "review",
                event: next.status === "outdated" ? "outdated" : "reanchored",
                review: next,
              });
              return next;
            }
            return review;
          }

          // commit-bound: HEAD の祖先でなくなっていれば内容一致で retarget を試みる
          const head = input.head ?? (await deps.gitHistory.headOf(review.worktreeRoot));
          if (head) {
            const reachable = await deps.gitHistory.isAncestor(
              review.worktreeRoot,
              review.target.hash,
              head,
            );
            if (!reachable) {
              const commit = await deps.finder.find(
                review.worktreeRoot,
                review,
                review.createdAtHead,
              );
              if (commit) {
                const r = retargetCommit(review, commit, deps.clock);
                if (r.isOk()) {
                  await deps.repository.save(r.value);
                  deps.events.emit({ type: "review", event: "reanchored", review: r.value });
                  return r.value;
                }
              }
            }
          }
          return review;
        })(),
      );
    });
  };
}
