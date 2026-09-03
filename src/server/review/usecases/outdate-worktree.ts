import { ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { markOutdated } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";

export type OutdateWorktreeDeps = {
  repository: ReviewRepository;
  clock: Clock;
  events: ReviewEvents;
  logger?: Pick<typeof console, "info">;
};

export type OutdateWorktreeInput = { repo?: string; worktreeRoot: string };

/**
 * plan §6.5「壊れ方」: worktree が削除されたら、その worktree に付いた未コミット
 * （＝worktree-bound）の open/replied レビューを outdated にする (F6)。
 * commit 付きレビューは対象外（commit の diff で表示され続けるため）。
 */
export function outdateWorktreeUsecase(deps: OutdateWorktreeDeps) {
  return function outdateWorktreeFn(input: OutdateWorktreeInput): ResultAsync<Review[], never> {
    const logger = deps.logger ?? console;
    return ResultAsync.fromSafePromise(
      (async () => {
        const reviews = await deps.repository.list({
          repo: input.repo,
          targetKind: "worktree",
          worktreeRoot: input.worktreeRoot,
          status: ["open", "replied"],
        });

        const changed: Review[] = [];
        for (const review of reviews) {
          const r = markOutdated(review, deps.clock);
          if (r.isErr()) continue;
          await deps.repository.save(r.value);
          logger.info(`review outdated id=${review.id} reason=worktree_removed`);
          deps.events.emit({ type: "review", event: "outdated", review: r.value });
          changed.push(r.value);
        }
        return changed;
      })(),
    );
  };
}
