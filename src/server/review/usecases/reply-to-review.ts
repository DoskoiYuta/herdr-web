import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { EntryAuthor, Review } from "../../../contract/review";
import { reply as replyDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";
import { createLocks, type Locks } from "./locks";

export type ReplyToReviewDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  /** F4: serializes against reanchorAfterChange/reanchorReview/resolve on the same review id */
  locks?: Locks;
};

export type ReplyToReviewInput = {
  id: string;
  author: EntryAuthor;
  body: string;
  agentSession?: string | null;
};

export function replyToReviewUsecase(deps: ReplyToReviewDeps) {
  const locks = deps.locks ?? createLocks();

  return function replyToReviewFn(input: ReplyToReviewInput): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(
      locks.withLock(`review:${input.id}`, async (): Promise<Result<Review, UsecaseError>> => {
        const review = await deps.repository.get(input.id);
        if (!review) return err(notFound(`review ${input.id} not found`));

        const result = replyDomain(
          review,
          { author: input.author, body: input.body, agentSession: input.agentSession },
          deps.clock,
        );
        if (result.isErr()) return err(result.error);

        const updated = result.value;
        await deps.repository.save(updated);
        deps.events.emit({ type: "review", event: "replied", review: updated });
        return ok(updated);
      }),
    ).andThen((r) => r);
  };
}
