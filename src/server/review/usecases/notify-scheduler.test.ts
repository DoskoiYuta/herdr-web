import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import {
  FakeAgentNotifier,
  FakeReviewEvents,
  FakeReviewRepository,
  ManualClock,
  ManualTimer,
} from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { createNotifyScheduler } from "./notify-scheduler";

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
});
