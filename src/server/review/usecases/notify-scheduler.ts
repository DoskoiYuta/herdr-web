import type { Review } from "../../../contract/review";
import type {
  AgentNotifier,
  Clock,
  ReviewEvents,
  ReviewRepository,
  Timer,
  TimerHandle,
} from "../ports";

export type NotifySchedulerDeps = {
  notifier: AgentNotifier;
  events: ReviewEvents;
  repository: ReviewRepository;
  clock: Clock;
  timer: Timer;
  debounceMs?: number;
};

export type NotifyScheduler = {
  /** レビュー作成時に呼ぶ。同じ worktreeRoot 宛はデバウンス窓内でまとめられる */
  schedule(review: Review): void;
  /** デバウンス中の通知をすべて即時発火する（テスト用） */
  flush(): Promise<void>;
  /** 1 件だけ即時に再送する */
  resend(reviewId: string): Promise<void>;
};

type PendingEntry = { commit: string | null; reviewIds: Set<string>; handle: TimerHandle };

/** レビュー作成時の通知を worktreeRoot 単位で debounceMs だけまとめて `agent.prompt` する */
export function createNotifyScheduler(deps: NotifySchedulerDeps): NotifyScheduler {
  const debounceMs = deps.debounceMs ?? 10_000;
  const pending = new Map<string, PendingEntry>();

  async function fire(worktreeRoot: string): Promise<void> {
    const entry = pending.get(worktreeRoot);
    if (!entry) return;
    pending.delete(worktreeRoot);

    const { result, pane } = await deps.notifier.notify({
      worktreeRoot,
      commit: entry.commit,
      reviewIds: [...entry.reviewIds],
    });
    for (const reviewId of entry.reviewIds) {
      deps.events.emit({ type: "review-notify", reviewId, result, pane });
    }
  }

  return {
    schedule(review: Review) {
      const worktreeRoot = review.worktreeRoot;
      const commit = review.target.kind === "commit" ? review.target.hash : null;

      const existing = pending.get(worktreeRoot);
      if (existing) {
        existing.reviewIds.add(review.id);
        if (commit) existing.commit = commit;
        return;
      }

      const handle = deps.timer.setTimeout(() => {
        void fire(worktreeRoot);
      }, debounceMs);
      pending.set(worktreeRoot, { commit, reviewIds: new Set([review.id]), handle });
    },

    async flush() {
      for (const [worktreeRoot, entry] of [...pending.entries()]) {
        deps.timer.clearTimeout(entry.handle);
        await fire(worktreeRoot);
      }
    },

    async resend(reviewId: string) {
      const review = await deps.repository.get(reviewId);
      if (!review) return;
      const { result, pane } = await deps.notifier.notify({
        worktreeRoot: review.worktreeRoot,
        commit: review.target.kind === "commit" ? review.target.hash : null,
        reviewIds: [reviewId],
      });
      deps.events.emit({ type: "review-notify", reviewId, result, pane });
    },
  };
}
