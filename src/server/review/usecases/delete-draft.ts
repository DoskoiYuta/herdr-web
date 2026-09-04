import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { Review } from "../../../contract/review";
import { deleteDraft as deleteDraftDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";
import { notFound, type UsecaseError } from "./errors";
import { createLocks, type Locks } from "./locks";

export type DeleteDraftDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  locks?: Locks;
};

export type DeleteDraftInput = { id: string; seq: number };
export type DeleteDraftResult = { deleted: boolean; review: Review | null };

/**
 * `DELETE /api/review/:id/draft/:seq`。削除後に thread が空になった review は
 * （下書きしか無かった review なので）丸ごと削除する — `deleted: true, review: null`。
 * それ以外は残った review を返す。
 */
export function deleteDraftUsecase(deps: DeleteDraftDeps) {
  const locks = deps.locks ?? createLocks();

  return function deleteDraftFn(
    input: DeleteDraftInput,
  ): ResultAsync<DeleteDraftResult, UsecaseError> {
    return ResultAsync.fromSafePromise(
      locks.withLock(
        `review:${input.id}`,
        async (): Promise<Result<DeleteDraftResult, UsecaseError>> => {
          const review = await deps.repository.get(input.id);
          if (!review) return err(notFound(`review ${input.id} not found`));

          const result = deleteDraftDomain(review, input.seq, deps.clock);
          if (result.isErr()) return err(result.error);

          const updated = result.value;
          if (updated.thread.length === 0) {
            await deps.repository.delete(updated.id);
            deps.events.emit({ type: "review", event: "deleted", review: updated });
            return ok({ deleted: true, review: null });
          }

          await deps.repository.save(updated);
          deps.events.emit({ type: "review", event: "draft-updated", review: updated });
          return ok({ deleted: false, review: updated });
        },
      ),
    ).andThen((r) => r);
  };
}
