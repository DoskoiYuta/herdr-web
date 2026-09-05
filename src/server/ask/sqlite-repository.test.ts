import { describe, expect, test } from "bun:test";
import type { Ask } from "../../contract/ask";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { createSqliteAskRepository } from "./sqlite-repository";

function makeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "ask-1",
    repo: "/repo",
    worktreeRoot: "/repo",
    path: "src/a.ts",
    anchor: {
      side: "new",
      lines: ["const x = 1;"],
      before: [],
      after: [],
      lineHint: 3,
      hash: "h",
    },
    createdAtHead: "head1",
    status: "open",
    session: { kind: "herdr", label: "ask:00000001" },
    thread: [
      { seq: 0, author: "user", body: "why?", at: "2026-09-05T00:00:00.000Z", agentSession: null },
    ],
    lastPrompt: { state: "sent", at: "2026-09-05T00:00:00.000Z" },
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("createSqliteAskRepository", () => {
  test("round-trips an ask (including a nullable session, thread and lastPrompt) through save/get", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteAskRepository(db);

    const ask = makeAsk();
    await repo.save(ask);
    expect(await repo.get(ask.id)).toEqual(ask);

    const paneAsk = makeAsk({
      id: "ask-2",
      session: { kind: "pane", paneId: "p1" },
      lastPrompt: null,
      createdAtHead: null,
    });
    await repo.save(paneAsk);
    expect(await repo.get(paneAsk.id)).toEqual(paneAsk);
  });

  test("list filters by repo/worktreeRoot/status/path", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteAskRepository(db);
    await repo.save(makeAsk({ id: "a", path: "src/a.ts", status: "open" }));
    await repo.save(makeAsk({ id: "b", path: "src/b.ts", status: "resolved" }));

    expect((await repo.list({ status: ["open"] })).map((a) => a.id)).toEqual(["a"]);
    expect((await repo.list({ path: "src/b.ts" })).map((a) => a.id)).toEqual(["b"]);
  });

  test("a re-save with a shorter thread replaces the old entries instead of leaving stale rows", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteAskRepository(db);
    const ask = makeAsk({
      thread: [
        { seq: 0, author: "user", body: "q1", at: "t0", agentSession: null },
        { seq: 1, author: "agent", body: "a1", at: "t1", agentSession: null },
      ],
    });
    await repo.save(ask);
    const firstEntry = ask.thread[0]!;
    const updated = { ...ask, thread: [firstEntry] };
    await repo.save(updated);
    expect((await repo.get(ask.id))!.thread).toEqual([firstEntry]);
  });
});
