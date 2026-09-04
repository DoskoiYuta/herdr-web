import type { Notify, NotifyState, Review } from "../../../contract/review";
import type {
  AgentNotifier,
  Clock,
  ReviewEvents,
  ReviewRepository,
  Timer,
  TimerHandle,
} from "../ports";
import { createLocks, type Locks } from "./locks";

export type NotifySchedulerDeps = {
  notifier: AgentNotifier;
  events: ReviewEvents;
  repository: ReviewRepository;
  clock: Clock;
  timer: Timer;
  debounceMs?: number;
  logger?: Pick<typeof console, "info" | "error">;
  /** F4/item-1: serializes notify persistence against reply/resolve/reanchor on the same review. */
  locks?: Locks;
  /**
   * item 3: whether herdr is currently connected. Defaults to always-connected.
   * `fire()` checks this before ever attempting a notify — while disconnected it
   * keeps the batch's reviews `pending` and reschedules with backoff instead of
   * persisting `no_target` (which would never be retried).
   */
  isConnected?: () => boolean;
};

export type NotifyScheduler = {
  /**
   * レビュー作成時、または送信時に呼ぶ。同じ worktreeRoot 宛はデバウンス窓内でまとめられる。
   * `worktreeRoot` 省略時は `review.worktreeRoot`（review が作られた worktree）宛。
   * send-drafts はここに送信を発行した worktree と、選んだ pane を渡す
   * （通知先をレビュー作成時の worktree ではなく送信元にする）。
   * `pane` は同じバッチ内では最後に渡されたものが勝つ（send は同じバッチの全 review に同じ pane を渡すので実質同一）。
   */
  schedule(review: Review, worktreeRoot?: string, pane?: string): void;
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

type PendingEntry = {
  reviewIds: Set<string>;
  /** send-drafts が選んだ通知先 pane。作成時通知（pane 未指定）では undefined */
  pane?: string;
  handle: TimerHandle;
  /** item 3: current backoff delay while herdr stays disconnected. */
  backoffMs?: number;
  /** item 3: how many disconnected-retry attempts this batch has made. */
  attempts?: number;
};

/** item 3: cap on the backoff delay between disconnected retries. */
const MAX_BACKOFF_MS = 60_000;
/** item 3: give up rescheduling (but leave reviews `pending` for drainPending on next start) after this many attempts. */
const MAX_RECONNECT_ATTEMPTS = 20;

/** レビュー作成時の通知を worktreeRoot 単位で debounceMs だけまとめて `agent.prompt` する */
export function createNotifyScheduler(deps: NotifySchedulerDeps): NotifyScheduler {
  const debounceMs = deps.debounceMs ?? 10_000;
  const logger = deps.logger ?? console;
  const locks = deps.locks ?? createLocks();
  const isConnected = deps.isConnected ?? (() => true);
  const pending = new Map<string, PendingEntry>();

  // item 1: the ONLY way this module ever persists a notify result — always
  // through `updateNotify` (which touches just the three notify columns, never
  // the whole row) and always under the review's lock, so a concurrent
  // reply/reanchor writing the rest of the row can never be clobbered.
  async function persistNotify(
    id: string,
    state: NotifyState,
    pane: string | null,
    at: string,
  ): Promise<void> {
    const notify: Notify = { state, pane, at };
    await locks.withLock(`review:${id}`, () => deps.repository.updateNotify(id, notify));
  }

  function scheduleTimer(
    worktreeRoot: string,
    entry: Omit<PendingEntry, "handle">,
    ms: number,
  ): void {
    const handle = deps.timer.setTimeout(() => {
      void fire(worktreeRoot);
    }, ms);
    pending.set(worktreeRoot, { ...entry, handle });
  }

  // item 3: herdr isn't connected — leave every review in this batch `pending`
  // (nothing to persist) and retry later with exponential backoff, capped.
  function rescheduleDisconnected(worktreeRoot: string, entry: PendingEntry): void {
    const attempts = (entry.attempts ?? 0) + 1;
    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `notify: root=${worktreeRoot} giving up after ${attempts - 1} disconnected retries; ` +
          `reviews stay pending and will be retried by drainPending on next startup`,
      );
      return;
    }
    const backoffMs = Math.min((entry.backoffMs ?? debounceMs) * 2, MAX_BACKOFF_MS);
    logger.info(
      `notify: root=${worktreeRoot} herdr not connected — retry ${attempts} in ${backoffMs}ms`,
    );
    scheduleTimer(
      worktreeRoot,
      { reviewIds: entry.reviewIds, pane: entry.pane, backoffMs, attempts },
      backoffMs,
    );
  }

  async function fire(worktreeRoot: string): Promise<void> {
    const entry = pending.get(worktreeRoot);
    if (!entry) return;
    pending.delete(worktreeRoot);

    if (!isConnected()) {
      rescheduleDisconnected(worktreeRoot, entry);
      return;
    }

    // item 7: track which ids this call has ALREADY persisted, so a later
    // failure never re-touches (and stomps) one that already landed correctly.
    const persistedIds = new Set<string>();

    try {
      // F5: re-check status right before prompting — a review resolved/outdated
      // while it sat in the debounce window must not be notified about.
      const candidates: Review[] = [];
      for (const id of entry.reviewIds) {
        const review = await deps.repository.get(id);
        if (!review) continue;
        if (review.status === "open" || review.status === "replied") {
          candidates.push(review);
        } else {
          // item 8: excluded from this batch — must not stay "pending" forever.
          const at = deps.clock.now().toISOString();
          await persistNotify(id, "none", null, at);
          persistedIds.add(id);
        }
      }
      if (candidates.length === 0) return;

      const { result, pane } = await deps.notifier.notify({
        worktreeRoot,
        reviewIds: candidates.map((r) => r.id),
        pane: entry.pane,
      });
      const at = deps.clock.now().toISOString();
      for (const review of candidates) {
        await persistNotify(review.id, result, pane, at);
        persistedIds.add(review.id);
        deps.events.emit({ type: "review-notify", reviewId: review.id, result, pane });
      }
      logger.info(
        `notify: root=${worktreeRoot} count=${candidates.length} result=${result} pane=${pane ?? "none"}`,
      );
    } catch (err) {
      const at = deps.clock.now().toISOString();
      for (const id of entry.reviewIds) {
        if (persistedIds.has(id)) continue; // item 7: already persisted — don't stomp it
        await persistNotify(id, "unknown", null, at).catch(() => {});
        deps.events.emit({ type: "review-notify", reviewId: id, result: "unknown", pane: null });
      }
      logger.error("notify: fire failed", err);
    }
  }

  function schedule(
    review: Review,
    worktreeRoot: string = review.worktreeRoot,
    pane?: string,
  ): void {
    const existing = pending.get(worktreeRoot);
    if (existing) {
      existing.reviewIds.add(review.id);
      if (pane) existing.pane = pane;
      return;
    }

    scheduleTimer(worktreeRoot, { reviewIds: new Set([review.id]), pane }, debounceMs);
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
          reviewIds: [reviewId],
        });
        const at = deps.clock.now().toISOString();
        await persistNotify(reviewId, result, pane, at);
        deps.events.emit({ type: "review-notify", reviewId, result, pane });
      } catch (err) {
        const at = deps.clock.now().toISOString();
        await persistNotify(reviewId, "unknown", null, at).catch(() => {});
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
