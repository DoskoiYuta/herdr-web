import { ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { markOutdated } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { createLocks, type Locks } from "./locks";

export type OutdateWorktreeDeps = {
  repository: ReviewRepository;
  clock: Clock;
  events: ReviewEvents;
  /** F5: serializes against reply/resolve/reanchor on the same review, and against a
   * concurrent outdateWorktree pass on the same root. Defaults to a private registry
   * (tests) when omitted. */
  locks?: Locks;
  logger?: Pick<typeof console, "info">;
};

export type OutdateWorktreeInput = { repo?: string; worktreeRoot: string };

/**
 * plan §6.5「壊れ方」: worktree が削除されたら、その worktree に付いた未コミット
 * （＝worktree-bound）の open/replied レビューを outdated にする (F6)。
 * commit 付きレビューは対象外（commit の diff で表示され続けるため）。
 */
export function outdateWorktreeUsecase(deps: OutdateWorktreeDeps) {
  const locks = deps.locks ?? createLocks();

  return function outdateWorktreeFn(input: OutdateWorktreeInput): ResultAsync<Review[], never> {
    const logger = deps.logger ?? console;
    return ResultAsync.fromSafePromise(
      // F5: serialize the whole pass on the root, so a concurrent outdateWorktree
      // pass over the same root can't duplicate work, matching reanchorAfterChange.
      locks.withLock(`root:${input.worktreeRoot}`, async () => {
        const listed = await deps.repository.list({
          repo: input.repo,
          targetKind: "worktree",
          worktreeRoot: input.worktreeRoot,
          status: ["open", "replied"],
        });

        const changed: Review[] = [];
        for (const entry of listed) {
          // F5: re-fetch under the per-review lock so a reply/resolve/reanchor
          // that landed after `list()` but before this write is never clobbered
          // by the stale snapshot `list()` returned.
          await locks.withLock(`review:${entry.id}`, async () => {
            const review = (await deps.repository.get(entry.id)) ?? entry;
            const r = markOutdated(review, deps.clock);
            if (r.isErr()) return;
            await deps.repository.save(r.value);
            logger.info(`review outdated id=${review.id} reason=worktree_removed`);
            deps.events.emit({ type: "review", event: "outdated", review: r.value });
            changed.push(r.value);
          });
        }
        return changed;
      }),
    );
  };
}
