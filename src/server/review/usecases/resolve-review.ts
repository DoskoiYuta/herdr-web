import { errAsync, ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { resolve as resolveDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";

export type ResolveReviewDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
};

/**
 * resolve できるのは user のみ（plan §F5-3 / §6.5）。
 * ドメインは author を取らないため、この境界（ルート層）で agent には出さないこと。
 */
export function resolveReviewUsecase(deps: ResolveReviewDeps) {
  return function resolveReviewFn(id: string): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(deps.repository.get(id)).andThen((review) => {
      if (!review) return errAsync(notFound(`review ${id} not found`));

      const result = resolveDomain(review, deps.clock);
      if (result.isErr()) return errAsync(result.error);

      const updated = result.value;
      return ResultAsync.fromSafePromise(
        (async () => {
          await deps.repository.save(updated);
          deps.events.emit({ type: "review", event: "resolved", review: updated });
          return updated;
        })(),
      );
    });
  };
}
