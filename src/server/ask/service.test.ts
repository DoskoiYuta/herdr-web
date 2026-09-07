import { err } from "neverthrow";
import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../contract/review";
import type { AskEvent } from "../../contract/ask";
import { createAskService } from "./service";
import { createFakeAskLauncher } from "./testing/fake-launcher";
import { FakeAskRepository } from "./testing/fake-repository";

const anchor: Anchor = {
  side: "new",
  lines: ["const x = 1;"],
  before: [],
  after: [],
  lineHint: 5,
  hash: "h",
};

function makeService(overrides: Partial<Parameters<typeof createFakeAskLauncher>[0]> = {}) {
  const repository = new FakeAskRepository();
  const { launcher, calls } = createFakeAskLauncher(overrides);
  const events: AskEvent[] = [];
  let nextId = 1;
  const service = createAskService({
    repository,
    launcher,
    clock: { now: () => new Date("2026-09-05T00:00:00.000Z") },
    events: { emit: (e) => events.push(e as AskEvent) },
    template: "id={id} path={path} {startLine}-{endLine} {code} q={question}",
    replyTemplate: "reply {id}",
    maxSessions: 5,
    generateId: () => `ask-${String(nextId++).padStart(16, "0")}`,
  });
  return { service, repository, calls, events };
}

const baseReq = {
  repo: "/repo",
  worktreeRoot: "/repo",
  path: "src/a.ts",
  anchor,
  createdAtHead: "head1",
  body: "why is this here?",
  target: { kind: "new" as const },
};

describe("createAsk", () => {
  test("target=new launches a workspace with the rendered prompt and saves the session", async () => {
    const { service, repository, calls, events } = makeService();
    const result = await service.createAsk(baseReq);
    expect(result.isOk()).toBe(true);
    const ask = result._unsafeUnwrap();
    expect(ask.session).toEqual({ kind: "herdr", label: `ask:${ask.id.slice(-8)}` });
    expect(ask.lastPrompt).toEqual({ state: "sent", at: "2026-09-05T00:00:00.000Z" });
    expect(await repository.get(ask.id)).toEqual(ask);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "ask", action: "created" });

    const startCall = calls.find((c) => c.kind === "start");
    expect(startCall?.prompt).toContain("why is this here?");
    expect(startCall?.prompt).toContain("src/a.ts");
    expect(startCall?.prompt).toContain("5-5");
  });

  test("a launch failure persists nothing and no event is emitted", async () => {
    const { service, repository, events } = makeService({
      startResult: err({ type: "herdr_unavailable" }),
    });
    const result = await service.createAsk(baseReq);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: "herdr_unavailable" });
    expect(await repository.list({})).toEqual([]);
    expect(events).toHaveLength(0);
  });

  test("limit_reached when maxSessions active herdr sessions already exist, without calling the launcher", async () => {
    const repository = new FakeAskRepository();
    const { launcher, calls } = createFakeAskLauncher();
    const service = createAskService({
      repository,
      launcher,
      clock: { now: () => new Date("2026-09-05T00:00:00.000Z") },
      events: { emit: () => {} },
      template: "{question}",
      replyTemplate: "reply {id}",
      maxSessions: 1,
      generateId: () => "existing-ask-id",
    });
    await service.createAsk(baseReq);
    const result = await service.createAsk({ ...baseReq, path: "src/b.ts" });
    expect(result._unsafeUnwrapErr()).toEqual({ type: "limit_reached", limit: 1 });
    // only the first createAsk's start call — the second was rejected before reaching the launcher
    expect(calls.filter((c) => c.kind === "start")).toHaveLength(1);
  });

  test("target=pane persists the ask even when the prompt is blocked, recording lastPrompt", async () => {
    const { service, repository } = makeService({ promptResult: err({ type: "agent_blocked" }) });
    const result = await service.createAsk({
      ...baseReq,
      target: { kind: "pane", paneId: "p1" },
    });
    const ask = result._unsafeUnwrap();
    expect(ask.session).toEqual({ kind: "pane", paneId: "p1" });
    expect(ask.lastPrompt).toEqual({ state: "agent_blocked", at: "2026-09-05T00:00:00.000Z" });
    expect(await repository.get(ask.id)).toEqual(ask);
  });
});

describe("replyAsk", () => {
  test("a user reply sets status to open and sends the reply prompt", async () => {
    const { service, calls } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    // Bring the ask to "replied" state first (simulating an agent's answer).
    await service.replyAsk({
      id: created.id,
      author: "agent",
      body: "because",
      agentSession: "s1",
    });

    const result = await service.replyAsk({ id: created.id, author: "user", body: "makes sense" });
    const ask = result._unsafeUnwrap();
    expect(ask.status).toBe("open");
    expect(ask.thread.map((e) => e.body)).toEqual(["why is this here?", "because", "makes sense"]);
    expect(calls.some((c) => c.kind === "prompt" && c.text === "reply ask-0000000000000001")).toBe(
      true,
    );
  });

  test("an agent reply sets status to replied and sends no prompt", async () => {
    const { service, calls } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    const promptCallsBefore = calls.filter((c) => c.kind === "prompt").length;

    const result = await service.replyAsk({
      id: created.id,
      author: "agent",
      body: "here's why",
      agentSession: "s1",
    });
    const ask = result._unsafeUnwrap();
    expect(ask.status).toBe("replied");
    expect(calls.filter((c) => c.kind === "prompt")).toHaveLength(promptCallsBefore);
  });

  test("not_found for an unknown id", async () => {
    const { service } = makeService();
    const result = await service.replyAsk({ id: "missing", author: "user", body: "x" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("not_found");
  });
});

describe("resolveAsk", () => {
  test("sets status resolved and closes the session", async () => {
    const { service, calls } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    const result = await service.resolveAsk(created.id);
    const ask = result._unsafeUnwrap();
    expect(ask.status).toBe("resolved");
    expect(calls.some((c) => c.kind === "close")).toBe(true);
  });
});

describe("forFile", () => {
  const lines = ["line0", "const x = 1;", "line2"];

  test("marks a non-resolved ask outdated when its anchor no longer matches", async () => {
    const { service, repository } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();

    const matches = await service.forFile({
      repo: "/repo",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines: ["totally different content"],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.startLine).toBeNull();
    expect((await repository.get(created.id))!.status).toBe("outdated");
  });

  test("brings an outdated ask back to open once the anchor matches again", async () => {
    const { service, repository } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    await service.forFile({
      repo: "/repo",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines: ["different"],
    });
    expect((await repository.get(created.id))!.status).toBe("outdated");

    const matches = await service.forFile({
      repo: "/repo",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines,
    });
    expect(matches[0]!.startLine).toBe(2);
    expect((await repository.get(created.id))!.status).toBe("open");
  });

  test("does not touch a resolved ask even when its anchor no longer matches", async () => {
    const { service, repository } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    await service.resolveAsk(created.id);

    await service.forFile({
      repo: "/repo",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines: ["different"],
    });
    expect((await repository.get(created.id))!.status).toBe("resolved");
  });

  // Without this, a resolved thread stays pinned in the code view forever —
  // the only way to make it go away is `hw ask list --all` / GET .../resolved.
  test("excludes a resolved ask from the returned matches", async () => {
    const { service } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    await service.resolveAsk(created.id);

    const matches = await service.forFile({
      repo: "/repo",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines,
    });
    expect(matches).toHaveLength(0);
  });
});

describe("counts", () => {
  test("counts open+replied asks per path, excluding resolved/outdated", async () => {
    const { service } = makeService();
    const a = (await service.createAsk(baseReq))._unsafeUnwrap();
    await service.createAsk({ ...baseReq, path: "src/b.ts" });
    await service.resolveAsk(a.id);

    const result = await service.counts("/repo", "/repo");
    expect(result.unresolved).toBe(1);
    expect(result.byPath).toEqual({ "src/b.ts": 1 });
  });

  // 無いと壊れる: M10 で Files タブに付けるバッジは replied 件数を数えるので、
  // フィールドが無ければバッジが常に 0/undefined になる。
  test("counts only replied asks separately from open", async () => {
    const { service } = makeService();
    const a = (await service.createAsk(baseReq))._unsafeUnwrap();
    await service.createAsk({ ...baseReq, path: "src/b.ts" });
    await service.replyAsk({ id: a.id, author: "agent", body: "answer" });

    const result = await service.counts("/repo", "/repo");
    expect(result.replied).toBe(1);
  });
});

describe("resendPrompt", () => {
  test("re-sends the last user entry's body", async () => {
    const { service, calls } = makeService();
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    const before = calls.filter((c) => c.kind === "prompt").length;

    const result = await service.resendPrompt(created.id);
    const ask = result._unsafeUnwrap();
    expect(ask.lastPrompt?.state).toBe("sent");
    const promptCalls = calls.filter((c) => c.kind === "prompt");
    expect(promptCalls).toHaveLength(before + 1);
    expect(promptCalls.at(-1)).toMatchObject({ text: "why is this here?" });
  });
});

describe("getAskWithSession", () => {
  test("attaches the live session status from the launcher", async () => {
    const { service } = makeService({ status: "blocked" });
    const created = (await service.createAsk(baseReq))._unsafeUnwrap();
    const withSession = await service.getAskWithSession(created.id);
    expect(withSession?.sessionStatus).toBe("blocked");
  });
});
