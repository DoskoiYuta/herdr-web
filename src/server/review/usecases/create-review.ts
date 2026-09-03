import { ResultAsync } from "neverthrow";
import type { CreateReviewRequest, Review } from "../../../contract/review";
import { createReview as createReviewDomain } from "../domain/transitions";
import type { Clock, ReviewEvents, ReviewRepository } from "../ports";

export type CreateReviewDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  /** 通知は debounce されるため、ユースケースはスケジュールするだけ */
  scheduleNotify: (review: Review) => void;
  /** テスト用に id 生成を差し替えられるようにする。既定は Bun.randomUUIDv7() */
  generateId?: () => string;
};

export function createReviewUsecase(deps: CreateReviewDeps) {
  const generateId = deps.generateId ?? (() => Bun.randomUUIDv7());

  return function createReviewFn(input: CreateReviewRequest): ResultAsync<Review, never> {
    const review = createReviewDomain(
      {
        id: generateId(),
        repo: input.repo,
        target: input.target,
        worktreeRoot: input.worktreeRoot,
        path: input.path,
        anchor: input.anchor,
        createdAtHead: input.createdAtHead,
        viewedAs: input.viewedAs,
        body: input.body,
        agentSession: input.agentSession ?? null,
      },
      deps.clock,
    );

    return ResultAsync.fromSafePromise(
      (async () => {
        await deps.repository.save(review);

        const existing = await deps.repository.getRepo(input.repo);
        const now = deps.clock.now().toISOString();
        await deps.repository.upsertRepo({
          key: input.repo,
          rootCommit: existing?.rootCommit ?? null,
          name: existing?.name ?? input.repo.split("/").filter(Boolean).pop() ?? input.repo,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now,
        });

        deps.events.emit({ type: "review", event: "created", review });
        deps.scheduleNotify(review);
        return review;
      })(),
    );
  };
}
