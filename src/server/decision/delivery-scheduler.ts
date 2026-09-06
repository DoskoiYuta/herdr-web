import type { Decision, DecisionDelivery } from "../../contract/decision";
import { createLocks, type Locks } from "../review/usecases/locks";
import type {
  Clock,
  DecisionEvents,
  DecisionNotifier,
  DecisionRepository,
  Timer,
  TimerHandle,
} from "./ports";
import { renderAnsweredPrompt, renderDismissedPrompt } from "./prompt";

export type DeliveryDeps = {
  repository: DecisionRepository;
  notifier: DecisionNotifier;
  events: DecisionEvents;
  clock: Clock;
  timer: Timer;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
  locks?: Locks;
  /** herdr が今つながっているか。切断中は接続まで指数バックオフで待つ (F13-9)。 */
  isConnected?: () => boolean;
  /** herdr の replay window が終わっているか。未settleの間はまだ pane 情報を
   * 信用できないので、切断中と同じ扱いで待つ (F13-9 の replay 誤判定対策)。 */
  isSettled?: () => boolean;
};

export type DeliveryScheduler = {
  /** answer/dismiss 直後、またはドレイン時に呼ぶ。即座に 1 回試みる。 */
  scheduleDelivery(id: string): void;
  /** 直近の配達が `sent` 以外の依頼への明示的な再送 (POST /:id/resend)。 */
  resend(id: string): Promise<void>;
  /** 起動時: 配達が終わっていない (answered/dismissed のまま) 依頼を拾い直す。 */
  drainPending(): Promise<void>;
};

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

function renderPrompt(decision: Decision): string {
  return decision.answer ? renderAnsweredPrompt(decision) : renderDismissedPrompt(decision);
}

function backoffMs(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export function createDeliveryScheduler(deps: DeliveryDeps): DeliveryScheduler {
  const logger = deps.logger ?? console;
  const locks = deps.locks ?? createLocks();
  const isConnected = deps.isConnected ?? (() => true);
  const isSettled = deps.isSettled ?? (() => true);
  const timers = new Map<string, TimerHandle>();

  function clearRetry(id: string): void {
    const handle = timers.get(id);
    if (handle) {
      deps.timer.clearTimeout(handle);
      timers.delete(id);
    }
  }

  /**
   * herdr 切断/replay 中は無期限に再試行する — 上限で諦めると、切断が長引いた
   * 依頼の回答が二度とエージェントへ届かなくなる。バックオフは 60 秒で頭打ち。
   */
  function scheduleRetry(id: string, attempts: number): void {
    const ms = backoffMs(attempts);
    logger.info(`decision-delivery: id=${id} not ready — retry ${attempts} in ${ms}ms`);
    const handle = deps.timer.setTimeout(() => {
      void attempt(id, attempts);
    }, ms);
    timers.set(id, handle);
  }

  async function markPending(decision: Decision, attempts: number): Promise<void> {
    const now = deps.clock.now().toISOString();
    const delivery: DecisionDelivery = {
      state: "pending",
      attempts,
      pane: decision.paneId,
      at: now,
    };
    await deps.repository.save({ ...decision, delivery });
    scheduleRetry(decision.id, attempts);
  }

  async function attempt(id: string, attempts = 0): Promise<void> {
    clearRetry(id);
    await locks.withLock(`decision:${id}`, async () => {
      const decision = await deps.repository.get(id);
      if (!decision) return;
      if (decision.status !== "answered" && decision.status !== "dismissed") return;
      // すでに送達済み: 自動再試行はここで止める（明示的な resend のみが再送する）。
      if (decision.delivery?.state === "sent") return;

      if (!isConnected() || !isSettled()) {
        await markPending(decision, attempts + 1);
        return;
      }

      const text = renderPrompt(decision);
      const result = await deps.notifier.deliver(decision.paneId, text);
      const now = deps.clock.now().toISOString();
      const nextAttempts = attempts + 1;
      const delivery: DecisionDelivery = {
        state: result.state,
        attempts: nextAttempts,
        pane: result.pane,
        at: now,
      };
      await deps.repository.save({ ...decision, delivery });

      if (result.state === "sent") {
        deps.events.emit({
          type: "decision",
          action: "delivered",
          id,
          worktreeRoot: decision.worktreeRoot,
          paneId: decision.paneId,
        });
        return;
      }

      deps.events.emit({
        type: "decision",
        action: "delivery-updated",
        id,
        worktreeRoot: decision.worktreeRoot,
        paneId: decision.paneId,
      });
      // agent_blocked は F13-9 の通り手動再送のみ（herdr は届いているので自動再試行すると
      // 相手を無視して連投することになる）。gone/unknown は無期限に再試行する。
      if (result.state === "gone" || result.state === "unknown") {
        scheduleRetry(id, nextAttempts);
      }
    });
  }

  return {
    scheduleDelivery(id: string): void {
      void attempt(id);
    },

    async resend(id: string): Promise<void> {
      clearRetry(id);
      const decision = await deps.repository.get(id);
      await attempt(id, decision?.delivery?.attempts ?? 0);
    },

    async drainPending(): Promise<void> {
      const all = await deps.repository.list({ status: ["answered", "dismissed"] });
      for (const decision of all) {
        if (decision.delivery?.state === "sent") continue;
        this.scheduleDelivery(decision.id);
      }
    },
  };
}
