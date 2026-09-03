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
  /**
   * F3/item-9: `createdAtHead` が古い（poller が commit を見逃した／作成前に既に
   * 進んでいた）場合に即座に commit-bind を試みるためのフック。
   * `review/runtime.ts` が `reanchorAfterChange` を `prevHead: null` で呼ぶよう配線する。
   * 保存の後、`created` を emit する前に呼ぶ — かつ `created` イベントと
   * `scheduleNotify` は afterCreate 完了後に再取得した最終状態の review を使う。
   * そうしないと、クライアントは worktree-bound な `created` を先に受け取ってから
   * すぐ `reanchored` を受け取ることになり、かつ notifyScheduler が
   * via-commit candidate の commit を見失う。
   */
  afterCreate?: (review: Review) => Promise<void>;
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

        await deps.afterCreate?.(review);
        // item 9: re-get after afterCreate so a worktree-bound `created` is never
        // emitted (and notified) ahead of a same-tick commit-binding — clients and
        // the notifier both see the final, settled state in one shot.
        const final = (await deps.repository.get(review.id)) ?? review;
        deps.events.emit({ type: "review", event: "created", review: final });
        deps.scheduleNotify(final);
        return final;
      })(),
    );
  };
}
