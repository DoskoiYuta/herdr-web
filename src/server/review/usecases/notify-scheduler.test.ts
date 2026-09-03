import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import type { AgentNotifier } from "../ports";
import {
  FakeAgentNotifier,
  FakeReviewEvents,
  FakeReviewRepository,
  ManualClock,
  ManualTimer,
} from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { createLocks } from "./locks";
import { createNotifyScheduler } from "./notify-scheduler";
import { replyToReviewUsecase } from "./reply-to-review";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: overrides.id ?? "r1",
        repo: "/repo",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    ),
    ...overrides,
  };
}

let repository: FakeReviewRepository;
let notifier: FakeAgentNotifier;
let events: FakeReviewEvents;
let timer: ManualTimer;

beforeEach(() => {
  repository = new FakeReviewRepository();
  notifier = new FakeAgentNotifier();
  events = new FakeReviewEvents();
  timer = new ManualTimer();
});

/** ManualTimer.advance は同期的にコールバックを呼ぶが、その中の async 処理
 *  （notifier.notify の await 後の events.emit）はマイクロタスクとして残るため、
 *  アサーション前にマイクロタスクをフラッシュする */
async function flushMicrotasks(): Promise<void> {
  // fire() chains several sequential awaits (per-id get, notify, per-review save);
  // give it enough microtask ticks to fully settle before asserting.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("createNotifyScheduler", () => {
  test("coalesces multiple reviews scheduled within the debounce window for the same worktree", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1" });
    const r2 = makeReview({ id: "r2" });
    await repository.save(r1);
    await repository.save(r2);
    scheduler.schedule(r1);
    timer.advance(5_000);
    scheduler.schedule(r2);
    timer.advance(5_000); // t=10s: r1's original 10s timer fires, coalescing r2 in
    await flushMicrotasks();

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.reviewIds.sort()).toEqual(["r1", "r2"]);

    timer.advance(10_000);
    await flushMicrotasks();
    // no more scheduled work
    expect(notifier.calls).toHaveLength(1);
  });

  test("does not coalesce reviews for different worktrees", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1", worktreeRoot: "/repo-a" });
    const r2 = makeReview({ id: "r2", worktreeRoot: "/repo-b" });
    await repository.save(r1);
    await repository.save(r2);
    scheduler.schedule(r1);
    scheduler.schedule(r2);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(notifier.calls).toHaveLength(2);
    const byRoot = new Map(notifier.calls.map((c) => [c.worktreeRoot, c.reviewIds]));
    expect(byRoot.get("/repo-a")).toEqual(["r1"]);
    expect(byRoot.get("/repo-b")).toEqual(["r2"]);
  });

  test("emits review-notify per review id with the notifier's result and pane", async () => {
    notifier.nextResult = "agent_blocked";
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1" });
    await repository.save(r1);
    scheduler.schedule(r1);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(events.events).toEqual([
      { type: "review-notify", reviewId: "r1", result: "agent_blocked", pane: null },
    ]);
    expect((await repository.get("r1"))?.notify.state).toBe("agent_blocked");
  });

  test("flush fires all pending notifications immediately", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1" });
    const r2 = makeReview({ id: "r2", worktreeRoot: "/other" });
    await repository.save(r1);
    await repository.save(r2);
    scheduler.schedule(r1);
    scheduler.schedule(r2);
    expect(notifier.calls).toHaveLength(0);

    await scheduler.flush();
    expect(notifier.calls).toHaveLength(2);
    expect(timer.pendingCount()).toBe(0);
  });

  // F5: a review that was resolved/outdated while it sat in the debounce window
  // must not be notified about — and must not count toward `{count}`.
  test("excludes resolved reviews from the batch and its count before notifying", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1" });
    const r2 = makeReview({ id: "r2", status: "resolved" });
    await repository.save(r1);
    await repository.save(r2);
    scheduler.schedule(r1);
    scheduler.schedule(r2);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.reviewIds).toEqual(["r1"]);
  });

  test("all reviews in the batch resolved -> does nothing", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const r1 = makeReview({ id: "r1", status: "resolved" });
    await repository.save(r1);
    scheduler.schedule(r1);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(notifier.calls).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  // F5: an exception anywhere in fire() must not crash the process — it should
  // resolve to `unknown`, be persisted, emitted, and logged.
  test("an exception during fire() is caught, persisted/emitted as unknown, and logged", async () => {
    const errors: unknown[] = [];
    const scheduler = createNotifyScheduler({
      notifier: {
        notify: async () => {
          throw new Error("herdr socket exploded");
        },
      },
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
      logger: { info() {}, error: (...args: unknown[]) => errors.push(args) },
    });

    const r1 = makeReview({ id: "r1" });
    await repository.save(r1);
    scheduler.schedule(r1);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(events.events).toEqual([
      { type: "review-notify", reviewId: "r1", result: "unknown", pane: null },
    ]);
    expect((await repository.get("r1"))?.notify.state).toBe("unknown");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("drainPending schedules every review whose notify.state is pending", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    const pendingReview = makeReview({ id: "r1" }); // createReview default: notify.state = "pending"
    const alreadySent = makeReview({
      id: "r2",
      notify: { state: "sent", pane: "p1", at: "2026-01-01T00:00:00.000Z" },
    });
    await repository.save(pendingReview);
    await repository.save(alreadySent);

    await scheduler.drainPending();
    timer.advance(10_000);
    await flushMicrotasks();

    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]?.reviewIds).toEqual(["r1"]);
  });

  test("resend re-notifies for a single review id immediately, bypassing debounce", async () => {
    await repository.save(makeReview({ id: "r1" }));
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    await scheduler.resend("r1");
    expect(notifier.calls).toEqual([{ worktreeRoot: "/repo", commit: null, reviewIds: ["r1"] }]);
    expect(events.events).toEqual([
      { type: "review-notify", reviewId: "r1", result: "sent", pane: "pane-1" },
    ]);
  });

  test("resend on an unknown review id is a no-op", async () => {
    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });
    await scheduler.resend("missing");
    expect(notifier.calls).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  // Item 1: fire()/resend()/persistNotify must never overwrite the whole review
  // row from a stale in-hand snapshot — only the notify columns — and must take
  // the shared review:<id> lock, so a reply landing mid-notify is never erased.
  test("a reply concurrent with resend keeps the reply (thread not overwritten)", async () => {
    const r1 = makeReview({ id: "r1", status: "open" });
    await repository.save(r1);

    let notifyCalled: () => void;
    const notifyCalledPromise = new Promise<void>((r) => {
      notifyCalled = r;
    });
    let releaseNotify: () => void;
    const notifyGate = new Promise<void>((r) => {
      releaseNotify = r;
    });
    const slowNotifier: AgentNotifier = {
      notify: async () => {
        notifyCalled();
        await notifyGate;
        return { result: "sent", pane: "pane-1" };
      },
    };

    const locks = createLocks();
    const scheduler = createNotifyScheduler({
      notifier: slowNotifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
      locks,
    });
    const replyToReview = replyToReviewUsecase({ repository, events, clock: CLOCK, locks });

    const resendPromise = scheduler.resend("r1");
    // resend has already read the review and is now blocked inside notifier.notify
    await notifyCalledPromise;

    const replyResult = await replyToReview({ id: "r1", author: "agent", body: "thread 2" });
    expect(replyResult.isOk()).toBe(true);

    releaseNotify!();
    await resendPromise;

    const final = await repository.get("r1");
    expect(final?.thread.map((e) => e.body)).toEqual(["why?", "thread 2"]);
    expect(final?.notify.state).toBe("sent");
  });

  // Item 3: when herdr isn't connected yet (e.g. drainPending firing at startup
  // before the socket is up), fire() must not persist "no_target" — it must keep
  // the reviews pending and reschedule with backoff.
  describe("herdr not connected", () => {
    test("fire() reschedules with backoff instead of persisting no_target while disconnected", async () => {
      let connected = false;
      const scheduler = createNotifyScheduler({
        notifier,
        events,
        repository,
        clock: CLOCK,
        timer,
        debounceMs: 1_000,
        isConnected: () => connected,
      });

      const r1 = makeReview({ id: "r1" });
      await repository.save(r1);
      scheduler.schedule(r1);

      timer.advance(1_000); // first debounce fires, but not connected
      await flushMicrotasks();
      expect(notifier.calls).toHaveLength(0);
      expect((await repository.get("r1"))?.notify.state).toBe("pending");
      expect(events.events).toHaveLength(0);

      // still not connected: next backoff tick (2x = 2000ms) also reschedules
      timer.advance(2_000);
      await flushMicrotasks();
      expect(notifier.calls).toHaveLength(0);
      expect((await repository.get("r1"))?.notify.state).toBe("pending");

      // now connected: the following backoff tick actually notifies
      connected = true;
      timer.advance(4_000);
      await flushMicrotasks();
      expect(notifier.calls).toHaveLength(1);
      expect((await repository.get("r1"))?.notify.state).toBe("sent");
    });

    test("drainPending's scheduled review is retried with backoff while disconnected, per a fake connected flag flipping", async () => {
      let connected = false;
      const scheduler = createNotifyScheduler({
        notifier,
        events,
        repository,
        clock: CLOCK,
        timer,
        debounceMs: 1_000,
        isConnected: () => connected,
      });

      const r1 = makeReview({ id: "r1" }); // notify.state: "pending" by default
      await repository.save(r1);

      await scheduler.drainPending();
      timer.advance(1_000);
      await flushMicrotasks();
      expect(notifier.calls).toHaveLength(0);

      connected = true;
      timer.advance(2_000);
      await flushMicrotasks();
      expect(notifier.calls).toHaveLength(1);
      expect(notifier.calls[0]?.reviewIds).toEqual(["r1"]);
    });
  });

  // Item 7: an exception in fire() must only mark "unknown" the ids that were
  // NOT already persisted earlier in the *same* fire() call — e.g. the batched
  // notifier.notify() succeeds and r1's updateNotify("sent") lands, but a later
  // review's updateNotify throws; r1 must stay "sent", not get stomped "unknown".
  test("fire()'s error path does not re-persist an id already persisted earlier in the same call", async () => {
    const r1 = makeReview({ id: "r1" });
    const r2 = makeReview({ id: "r2" });
    await repository.save(r1);
    await repository.save(r2);

    const repoWithFlakyUpdate = {
      get: repository.get.bind(repository),
      list: repository.list.bind(repository),
      save: repository.save.bind(repository),
      upsertRepo: repository.upsertRepo.bind(repository),
      getRepo: repository.getRepo.bind(repository),
      listRepos: repository.listRepos.bind(repository),
      moveRepo: repository.moveRepo.bind(repository),
      updateNotify: async (id: string, notify: Review["notify"]) => {
        if (id === "r2" && notify.state !== "unknown") {
          throw new Error("db write failed for r2");
        }
        await repository.updateNotify(id, notify);
      },
    };

    const scheduler = createNotifyScheduler({
      notifier, // resolves "sent" for the whole batch
      events,
      repository: repoWithFlakyUpdate,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });

    scheduler.schedule(r1);
    scheduler.schedule(r2);
    timer.advance(10_000);
    await flushMicrotasks();

    // r1's updateNotify succeeded ("sent") before r2's threw — the catch block
    // must not re-persist r1 as "unknown".
    expect((await repository.get("r1"))?.notify.state).toBe("sent");
    expect((await repository.get("r2"))?.notify.state).toBe("unknown");
  });

  // Item 8: reviews filtered out of the notification batch (resolved/outdated
  // while sitting in the debounce window) must not stay "pending" forever.
  test("reviews filtered out of the batch are persisted as notify.state = 'none'", async () => {
    const r1 = makeReview({ id: "r1", status: "open" });
    const r2 = makeReview({ id: "r2", status: "resolved" }); // filtered out
    await repository.save(r1);
    await repository.save(r2);
    expect((await repository.get("r2"))?.notify.state).toBe("pending");

    const scheduler = createNotifyScheduler({
      notifier,
      events,
      repository,
      clock: CLOCK,
      timer,
      debounceMs: 10_000,
    });
    scheduler.schedule(r1);
    scheduler.schedule(r2);
    timer.advance(10_000);
    await flushMicrotasks();

    expect(notifier.calls[0]?.reviewIds).toEqual(["r1"]);
    expect((await repository.get("r2"))?.notify.state).toBe("none");
    // still no event for the filtered-out review
    const idsEmitted = events.events
      .filter((e) => e.type === "review-notify")
      .map((e) => (e as { reviewId: string }).reviewId);
    expect(idsEmitted).toEqual(["r1"]);
  });
});
