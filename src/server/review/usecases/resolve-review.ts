import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { Review } from "../../../contract/review";
import { resolve as resolveDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";
import { createLocks, type Locks } from "./locks";

export type ResolveReviewDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  /** F4: serializes against reanchorAfterChange/reanchorReview/reply on the same review id */
  locks?: Locks;
};

/**
 * resolve できるのは user のみ（plan §F5-3 / §6.5）。
 * ドメインは author を取らないため、この境界（ルート層）で agent には出さないこと。
 */
export function resolveReviewUsecase(deps: ResolveReviewDeps) {
  const locks = deps.locks ?? createLocks();

  return function resolveReviewFn(id: string): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(
      locks.withLock(`review:${id}`, async (): Promise<Result<Review, UsecaseError>> => {
        const review = await deps.repository.get(id);
        if (!review) return err(notFound(`review ${id} not found`));

        const result = resolveDomain(review, deps.clock);
        if (result.isErr()) return err(result.error);

        const updated = result.value;
        await deps.repository.save(updated);
        deps.events.emit({ type: "review", event: "resolved", review: updated });
        return ok(updated);
      }),
    ).andThen((r) => r);
  };
}
