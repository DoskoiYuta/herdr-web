import { describe, expect, test } from "bun:test";
import type { DecisionAnswer, DecisionEvent } from "../../contract/decision";
import { ManualClock } from "../review/testing/fakes";
import type { DeliveryScheduler } from "./delivery-scheduler";
import type { WhoamiResolver } from "./ports";
import { createDecisionService } from "./service";
import { FakeDecisionRepository } from "./testing/fake-repository";

function fakeWhoami(
  map: Record<
    string,
    { worktreeRoot: string | null; repoKey: string | null; agent: string | null }
  >,
): WhoamiResolver {
  return {
    async resolve(paneId) {
      return map[paneId] ?? null;
    },
  };
}

function fakeDelivery() {
  const scheduled: string[] = [];
  const resent: string[] = [];
  const delivery: DeliveryScheduler = {
    scheduleDelivery(id) {
      scheduled.push(id);
    },
    async resend(id) {
      resent.push(id);
    },
    async drainPending() {},
  };
  return { delivery, scheduled, resent };
}

function setup() {
  const repository = new FakeDecisionRepository();
  const events: DecisionEvent[] = [];
  const clock = new ManualClock("2026-09-06T00:00:00.000Z");
  const { delivery, scheduled, resent } = fakeDelivery();
  const whoami = fakeWhoami({
    "pane-1": { worktreeRoot: "/repo", repoKey: "/repo/.git", agent: "claude" },
  });
  const service = createDecisionService({
    repository,
    whoami,
    delivery,
    clock,
    events: { emit: (e) => events.push(e) },
    alerter: { show: async () => {} },
    generateId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { repository, events, service, scheduled, resent };
}

const spec = {
  title: "t",
  context: [],
  items: [
    {
      id: "q1",
      header: "h",
      question: "q",
      kind: "single" as const,
      options: [],
      allowOther: true,
      required: true,
    },
  ],
  layout: null,
};

describe("createDecisionService.createDecision", () => {
  // 無いと壊れる: サイドバーが依頼をどの worktree に紐づけるか分からず、
  // 「判断依頼 N」行に出せない。
  test("resolves worktreeRoot/repoKey/agent from paneId via whoami", async () => {
    const { service } = setup();
    const decision = await service.createDecision({
      spec,
      paneId: "pane-1",
      claudeSessionId: null,
    });
    expect(decision.worktreeRoot).toBe("/repo");
    expect(decision.repoKey).toBe("/repo/.git");
    expect(decision.agent).toBe("claude");
    expect(decision.status).toBe("open");
  });

  // 無いと壊れる: pane が未指定/解決不能のときエラーで落ちてしまい、
  // `hw decision request --pane` を省略した呼び出しが使えなくなる。
  test("leaves worktreeRoot null when paneId is absent", async () => {
    const { service } = setup();
    const decision = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    expect(decision.worktreeRoot).toBeNull();
  });
});

describe("createDecisionService.answerDecision", () => {
  const answer: DecisionAnswer = {
    answers: { q1: { selected: ["A"], other: null, note: null } },
  };

  // 無いと壊れる: 回答しても配達が一度も試みられず、エージェントに結果が
  // 永久に届かない。
  test("moves an open decision to answered and schedules delivery", async () => {
    const { service, scheduled } = setup();
    const created = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    const result = await service.answerDecision(created.id, answer);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe("answered");
    expect(scheduled).toEqual([created.id]);
  });

  // 無いと壊れる: 既に answered/delivered な依頼へ二重回答でき、配達済みの
  // 判断が上書きされてしまう。
  test("rejects answering a decision that is not open", async () => {
    const { service } = setup();
    const created = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    await service.answerDecision(created.id, answer);
    const second = await service.answerDecision(created.id, answer);
    expect(second.isErr()).toBe(true);
  });
});

describe("createDecisionService.dismissDecision", () => {
  // 無いと壊れる: 却下してから何分経ったか UI のメタ行/フッタに出せない。
  test("dismissing an open decision sets answeredAt", async () => {
    const { service } = setup();
    const created = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    const result = await service.dismissDecision(created.id);
    expect(result._unsafeUnwrap().answeredAt).not.toBeNull();
  });
});

describe("createDecisionService.cancelDecision", () => {
  // 無いと壊れる: エージェントが取り下げた依頼にまで agent.prompt が送られ、
  // 自分自身が出した依頼への通知が二重に届く。
  test("cancelling an open decision does not schedule a delivery", async () => {
    const { service, scheduled } = setup();
    const created = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    const result = await service.cancelDecision(created.id);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe("cancelled");
    expect(scheduled).toEqual([]);
  });

  // 無いと壊れる: 取り下げてから何分経ったか UI のメタ行/フッタに出せない。
  test("cancelling an open decision sets answeredAt", async () => {
    const { service } = setup();
    const created = await service.createDecision({
      spec,
      paneId: null,
      claudeSessionId: null,
    });
    const result = await service.cancelDecision(created.id);
    expect(result._unsafeUnwrap().answeredAt).not.toBeNull();
  });
});

describe("createDecisionService.counts", () => {
  // 無いと壊れる: サイドバー上部の合計バッジと worktree ごとの行の件数が
  // ずれる/常に 0 になる。
  test("counts only open decisions, grouped by worktreeRoot", async () => {
    const { service, repository } = setup();
    await service.createDecision({
      spec,
      paneId: "pane-1",
      claudeSessionId: null,
    });
    const closed = await service.createDecision({
      spec,
      paneId: "pane-1",
      claudeSessionId: null,
    });
    await service.cancelDecision(closed.id);

    const counts = await service.counts();
    expect(counts.total).toBe(1);
    // sanity: the cancelled one is really gone from the store's open set
    expect((await repository.get(closed.id))?.status).toBe("cancelled");
  });
});
