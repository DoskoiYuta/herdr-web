import { describe, expect, test } from "bun:test";
import type { Decision } from "../../contract/decision";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { createSqliteDecisionRepository } from "./sqlite-repository";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "decision-1",
    status: "open",
    spec: {
      title: "title",
      context: [{ kind: "markdown", text: "hi" }],
      items: [
        {
          id: "q1",
          header: "方針",
          question: "どちらにしますか?",
          kind: "single",
          options: [{ label: "A", description: null, recommended: true, preview: [] }],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: null,
    paneId: "pane-1",
    claudeSessionId: "sess-1",
    worktreeRoot: "/repo",
    repoKey: "/repo/.git",
    agent: "claude",
    createdAt: "2026-09-05T00:00:00.000Z",
    answeredAt: null,
    delivery: null,
    ...overrides,
  };
}

describe("createSqliteDecisionRepository", () => {
  // 無いと壊れる: spec/answer/delivery の JSON カラムが保存/復元の往復で壊れ、
  // 依頼の内容が読み出せなくなる。
  test("round-trips a decision (spec, nullable answer/delivery) through save/get", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteDecisionRepository(db);

    const decision = makeDecision();
    await repo.save(decision);
    expect(await repo.get(decision.id)).toEqual(decision);

    const answered = makeDecision({
      id: "decision-2",
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: "ok" } }, attachments: [] },
      answeredAt: "2026-09-05T00:01:00.000Z",
      delivery: { state: "sent", attempts: 1, pane: "pane-1", at: "2026-09-05T00:01:05.000Z" },
    });
    await repo.save(answered);
    expect(await repo.get(answered.id)).toEqual(answered);
  });

  // 無いと壊れる: 一覧の status / worktreeRoot 絞り込みができず、サイドバーの
  // open 件数やフィルタが常に全件を返してしまう。
  test("list filters by status and worktreeRoot", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteDecisionRepository(db);
    await repo.save(makeDecision({ id: "a", status: "open", worktreeRoot: "/repo-a" }));
    await repo.save(makeDecision({ id: "b", status: "cancelled", worktreeRoot: "/repo-b" }));

    expect((await repo.list({ status: ["open"] })).map((d) => d.id)).toEqual(["a"]);
    expect((await repo.list({ worktreeRoot: "/repo-b" })).map((d) => d.id)).toEqual(["b"]);
  });
});
