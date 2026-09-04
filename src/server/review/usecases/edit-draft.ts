import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { Review } from "../../../contract/review";
import { editDraft as editDraftDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";
import { createLocks, type Locks } from "./locks";

export type EditDraftDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  locks?: Locks;
};

export type EditDraftInput = { id: string; seq: number; body: string };

export function editDraftUsecase(deps: EditDraftDeps) {
  const locks = deps.locks ?? createLocks();

  return function editDraftFn(input: EditDraftInput): ResultAsync<Review, UsecaseError> {
    return ResultAsync.fromSafePromise(
      locks.withLock(`review:${input.id}`, async (): Promise<Result<Review, UsecaseError>> => {
        const review = await deps.repository.get(input.id);
        if (!review) return err(notFound(`review ${input.id} not found`));

        const result = editDraftDomain(review, input.seq, input.body, deps.clock);
        if (result.isErr()) return err(result.error);

        const updated = result.value;
        await deps.repository.save(updated);
        deps.events.emit({ type: "review", event: "draft-updated", review: updated });
        return ok(updated);
      }),
    ).andThen((r) => r);
  };
}
