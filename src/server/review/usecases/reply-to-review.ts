import { errAsync, ResultAsync } from "neverthrow";
import type { EntryAuthor, Review } from "../../../contract/review";
import { reply as replyDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";

export type ReplyToReviewDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
};

export type ReplyToReviewInput = {
  id: string;
  author: EntryAuthor;
  body: string;
  agentSession?: string | null;
};

export function replyToReviewUsecase(deps: ReplyToReviewDeps) {
  return function replyToReviewFn(input: ReplyToReviewInput): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(deps.repository.get(input.id)).andThen((review) => {
      if (!review) return errAsync(notFound(`review ${input.id} not found`));

      const result = replyDomain(
        review,
        { author: input.author, body: input.body, agentSession: input.agentSession },
        deps.clock,
      );
      if (result.isErr()) return errAsync(result.error);

      const updated = result.value;
      return ResultAsync.fromSafePromise(
        (async () => {
          await deps.repository.save(updated);
          deps.events.emit({ type: "review", event: "replied", review: updated });
          return updated;
        })(),
      );
    });
  };
}
