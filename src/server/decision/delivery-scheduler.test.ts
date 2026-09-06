import { describe, expect, test } from "bun:test";
import type { Decision, DecisionEvent } from "../../contract/decision";
import { ManualClock, ManualTimer } from "../review/testing/fakes";
import { createDeliveryScheduler } from "./delivery-scheduler";
import { FakeDecisionRepository } from "./testing/fake-repository";
import { createFakeDecisionNotifier } from "./testing/fake-notifier";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d1",
    status: "answered",
    spec: {
      title: null,
      context: [],
      items: [
        {
          id: "q1",
          header: "h",
          question: "q",
          kind: "single",
          options: [],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: { answers: { q1: { selected: ["A"], other: null, note: null } }, attachments: [] },
    paneId: "pane-1",
    claudeSessionId: null,
    worktreeRoot: "/repo",
    repoKey: "/repo/.git",
    agent: "claude",
    createdAt: "2026-09-05T00:00:00.000Z",
    answeredAt: "2026-09-05T00:01:00.000Z",
    delivery: null,
    ...overrides,
  };
}

function setup(opts: { isConnected?: () => boolean; isSettled?: () => boolean } = {}) {
  const repository = new FakeDecisionRepository();
  const events: DecisionEvent[] = [];
  const clock = new ManualClock("2026-09-05T00:02:00.000Z");
  const timer = new ManualTimer();
  const { notifier, calls, setResult } = createFakeDecisionNotifier();
  const scheduler = createDeliveryScheduler({
    repository,
    notifier,
    events: { emit: (e) => events.push(e) },
    clock,
    timer,
    logger: { info() {}, warn() {}, error() {} },
    isConnected: opts.isConnected,
    isSettled: opts.isSettled,
  });
  return { repository, events, clock, timer, notifier, calls, setResult, scheduler };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("createDeliveryScheduler", () => {
  // 無いと壊れる: 回答が送信できても delivery.state が sent に進まず、
  // UI がいつまでも「配達中」のまま止まって見える。
  test("a successful delivery records delivery.state=sent without changing status", async () => {
    const { repository, events, scheduler } = setup();
    await repository.save(makeDecision());
    scheduler.scheduleDelivery("d1");
    await settle();

    const updated = await repository.get("d1");
    expect(updated?.status).toBe("answered");
    expect(updated?.delivery?.state).toBe("sent");
    expect(events.map((e) => e.action)).toEqual(["delivered"]);
  });

  // 無いと壊れる (F13-4): 却下は配達が終わっても dismissed のまま残らないと、
  // `hw decision list --status dismissed` で二度と引けなくなる。
  test("a successful delivery for a dismissed decision leaves status=dismissed", async () => {
    const { repository, scheduler } = setup();
    await repository.save(makeDecision({ status: "dismissed", answer: null }));
    scheduler.scheduleDelivery("d1");
    await settle();

    const updated = await repository.get("d1");
    expect(updated?.status).toBe("dismissed");
    expect(updated?.delivery?.state).toBe("sent");
  });

  // 無いと壊れる: pane が blocked のとき delivery.state が agent_blocked に
  // ならず、人間が「再送」を出せる状態にたどり着けない。
  test("agent_blocked is recorded without an automatic retry", async () => {
    const { repository, scheduler, setResult, timer } = setup();
    setResult({ state: "agent_blocked", pane: "pane-1" });
    await repository.save(makeDecision());
    scheduler.scheduleDelivery("d1");
    await settle();

    expect((await repository.get("d1"))?.delivery?.state).toBe("agent_blocked");
    expect(timer.pendingCount()).toBe(0);
  });

  // 無いと壊れる: herdr 切断中に配達を試みて失敗扱いにしてしまい、
  // 再接続しても自動では届かなくなる。
  test("while herdr is disconnected it retries with backoff instead of failing", async () => {
    let connected = false;
    const { repository, timer, scheduler, calls } = setup({ isConnected: () => connected });
    await repository.save(makeDecision());
    scheduler.scheduleDelivery("d1");
    await settle();
    expect(calls.length).toBe(0);
    expect((await repository.get("d1"))?.delivery?.state).toBe("pending");

    connected = true;
    timer.advance(1_000);
    await settle();

    expect(calls.length).toBe(1);
    expect((await repository.get("d1"))?.delivery?.state).toBe("sent");
  });

  // 無いと壊れる (F13-9): 20 回を超えて切断が続くと配達を諦め、herdr が
  // 復帰しても回答が二度とエージェントへ届かなくなる。
  test("retries past 20 attempts without giving up while disconnected", async () => {
    const { repository, timer, scheduler } = setup({ isConnected: () => false });
    await repository.save(makeDecision());
    scheduler.scheduleDelivery("d1");
    await settle();

    for (let i = 0; i < 25; i++) {
      timer.advance(60_000);
      await settle();
    }

    const updated = await repository.get("d1");
    expect(updated?.delivery?.attempts).toBeGreaterThan(20);
    expect(updated?.status).toBe("answered");
    expect(updated?.delivery?.state).toBe("pending");
  });

  // 無いと壊れる (F13-9): 再接続直後の replay 窓で pane が一時的に消えて
  // 見えるだけなのに `gone` と誤判定し、実際には配達可能な依頼を諦めてしまう。
  test("waits for isSettled() before attempting delivery, instead of misreading replay as gone", async () => {
    let settled = false;
    const { repository, timer, scheduler, calls } = setup({ isSettled: () => settled });
    await repository.save(makeDecision());
    scheduler.scheduleDelivery("d1");
    await settle();
    expect(calls.length).toBe(0);
    expect((await repository.get("d1"))?.delivery?.state).toBe("pending");

    settled = true;
    timer.advance(1_000);
    await settle();

    expect(calls.length).toBe(1);
    expect((await repository.get("d1"))?.delivery?.state).toBe("sent");
  });

  // 無いと壊れる: プロセス再起動で debounce タイマーごと消えた「配達待ち」の
  // 依頼が二度と配達されず、人間の回答が永久にエージェントへ届かない。
  test("drainPending re-schedules decisions stuck without a sent delivery", async () => {
    const { repository, scheduler } = setup();
    await repository.save(makeDecision({ id: "stuck", status: "dismissed", answer: null }));
    await repository.save(
      makeDecision({
        id: "done",
        delivery: { state: "sent", attempts: 1, pane: "pane-1", at: "" },
      }),
    );
    await scheduler.drainPending();
    await settle();

    expect((await repository.get("stuck"))?.delivery?.state).toBe("sent");
    // already-sent decisions are left untouched, not re-delivered
    expect((await repository.get("done"))?.delivery?.attempts).toBe(1);
  });

  // 無いと壊れる: `delivery.state !== "sent"` の依頼への「再送」ボタンが
  // 実際には何も送らない。
  test("resend retries a decision whose last delivery attempt failed", async () => {
    const { repository, scheduler, setResult, calls } = setup();
    await repository.save(
      makeDecision({
        delivery: {
          state: "agent_blocked",
          attempts: 1,
          pane: "pane-1",
          at: "2026-09-05T00:01:00.000Z",
        },
      }),
    );
    setResult({ state: "sent", pane: "pane-1" });
    await scheduler.resend("d1");

    expect(calls.length).toBe(1);
    const updated = await repository.get("d1");
    expect(updated?.delivery?.state).toBe("sent");
    expect(updated?.delivery?.attempts).toBe(2);
  });
});
