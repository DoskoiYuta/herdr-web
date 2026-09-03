import type { Review } from "../../../contract/review";
import type {
  AgentNotifier,
  Clock,
  NotifyResult,
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
  logger?: Pick<typeof console, "info" | "error">;
};

export type NotifyScheduler = {
  /** レビュー作成時に呼ぶ。同じ worktreeRoot 宛はデバウンス窓内でまとめられる */
  schedule(review: Review): void;
  /** デバウンス中の通知をすべて即時発火する（テスト用） */
  flush(): Promise<void>;
  /** 1 件だけ即時に再送する */
  resend(reviewId: string): Promise<void>;
  /**
   * F5: 起動時に一度呼ぶ。`notify.state === "pending"` のまま永続化されている
   * （＝プロセスが落ちて debounce タイマーごと消えた）レビューを再スケジュールする。
   */
  drainPending(): Promise<void>;
};

type PendingEntry = { commit: string | null; reviewIds: Set<string>; handle: TimerHandle };

async function persistNotify(
  repository: ReviewRepository,
  review: Review,
  state: NotifyResult,
  pane: string | null,
  at: string,
): Promise<void> {
  await repository.save({ ...review, notify: { state, pane, at } });
}

/** レビュー作成時の通知を worktreeRoot 単位で debounceMs だけまとめて `agent.prompt` する */
export function createNotifyScheduler(deps: NotifySchedulerDeps): NotifyScheduler {
  const debounceMs = deps.debounceMs ?? 10_000;
  const logger = deps.logger ?? console;
  const pending = new Map<string, PendingEntry>();

  async function fire(worktreeRoot: string): Promise<void> {
    const entry = pending.get(worktreeRoot);
    if (!entry) return;
    pending.delete(worktreeRoot);

    try {
      // F5: re-check status right before prompting — a review resolved/outdated
      // while it sat in the debounce window must not be notified about.
      const candidates: Review[] = [];
      for (const id of entry.reviewIds) {
        const review = await deps.repository.get(id);
        if (review && (review.status === "open" || review.status === "replied")) {
          candidates.push(review);
        }
      }
      if (candidates.length === 0) return;

      const { result, pane } = await deps.notifier.notify({
        worktreeRoot,
        commit: entry.commit,
        reviewIds: candidates.map((r) => r.id),
      });
      const at = deps.clock.now().toISOString();
      for (const review of candidates) {
        await persistNotify(deps.repository, review, result, pane, at);
        deps.events.emit({ type: "review-notify", reviewId: review.id, result, pane });
      }
      logger.info(
        `notify: root=${worktreeRoot} count=${candidates.length} result=${result} pane=${pane ?? "none"}`,
      );
    } catch (err) {
      const at = deps.clock.now().toISOString();
      for (const id of entry.reviewIds) {
        const review = await deps.repository.get(id).catch(() => null);
        if (review)
          await persistNotify(deps.repository, review, "unknown", null, at).catch(() => {});
        deps.events.emit({ type: "review-notify", reviewId: id, result: "unknown", pane: null });
      }
      logger.error("notify: fire failed", err);
    }
  }

  function schedule(review: Review): void {
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
  }

  return {
    schedule,

    async flush() {
      for (const [worktreeRoot, entry] of [...pending.entries()]) {
        deps.timer.clearTimeout(entry.handle);
        await fire(worktreeRoot);
      }
    },

    async resend(reviewId: string) {
      const review = await deps.repository.get(reviewId);
      if (!review) return;
      try {
        const { result, pane } = await deps.notifier.notify({
          worktreeRoot: review.worktreeRoot,
          commit: review.target.kind === "commit" ? review.target.hash : null,
          reviewIds: [reviewId],
        });
        const at = deps.clock.now().toISOString();
        await persistNotify(deps.repository, review, result, pane, at);
        deps.events.emit({ type: "review-notify", reviewId, result, pane });
      } catch (err) {
        const at = deps.clock.now().toISOString();
        await persistNotify(deps.repository, review, "unknown", null, at).catch(() => {});
        deps.events.emit({ type: "review-notify", reviewId, result: "unknown", pane: null });
        logger.error("notify: resend failed", err);
      }
    },

    async drainPending() {
      const all = await deps.repository.list({});
      for (const review of all) {
        if (review.notify.state === "pending") schedule(review);
      }
    },
  };
}
