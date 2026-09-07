import { err } from "neverthrow";
import { describe, expect, test } from "bun:test";
import type { AskTarget } from "../../contract/ask";
import type { Anchor } from "../../contract/review";
import { createFakeAskLauncher } from "../ask/testing/fake-launcher";
import { createTestApp } from "../testing/app-deps";

/** `Response#json()` is typed `unknown`; this narrows it for test assertions only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

const anchor: Anchor = {
  side: "new",
  lines: ["const x = 1;"],
  before: [],
  after: [],
  lineHint: 5,
  hash: "h",
};

const createBody = {
  repo: "/repo",
  worktreeRoot: "/repo",
  path: "src/a.ts",
  anchor,
  createdAtHead: "head1",
  body: "why is this here?",
  target: { kind: "new" } as AskTarget,
};

function postAsk(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  overrides: Partial<typeof createBody> = {},
) {
  return app.request("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...createBody, ...overrides }),
  });
}

describe("POST /api/ask", () => {
  test("201 with the created ask on success", async () => {
    const { launcher } = createFakeAskLauncher();
    const { app } = createTestApp({ askLauncher: launcher });
    const res = await postAsk(app);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.status).toBe("open");
    expect(body.session).toEqual({
      kind: "herdr",
      label: `ask:${body.id.slice(-8)}`,
      agent: "claude",
    });
  });

  // 無いと壊れる: サービス層の unknown_agent がここでマップされていないと、
  // 存在しないエージェントの選択が 500 として返り、UI がエラー文言を出し分けられない。
  test("400 unknown_agent when the requested agent isn't in config.ask.agents", async () => {
    const { launcher } = createFakeAskLauncher();
    const { app } = createTestApp({ askLauncher: launcher });
    const res = await postAsk(app, { target: { kind: "new", agent: "gpt4" } });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("unknown_agent");
    expect(body.agents).toEqual(["claude", "codex", "gemini"]);
  });

  test("409 limit_reached when maxSessions is exhausted", async () => {
    const { launcher } = createFakeAskLauncher();
    const { app } = createTestApp({ askLauncher: launcher });
    // config.ask.maxSessions defaults to 5
    for (let i = 0; i < 5; i++) {
      const res = await postAsk(app, { path: `src/${i}.ts` });
      expect(res.status).toBe(201);
    }
    const res = await postAsk(app, { path: "src/overflow.ts" });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("limit_reached");
  });

  test("503 herdr_unavailable when the launcher cannot start a workspace", async () => {
    const { launcher } = createFakeAskLauncher({
      startResult: err({ type: "herdr_unavailable" }),
    });
    const { app } = createTestApp({ askLauncher: launcher });
    const res = await postAsk(app);
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("herdr_unavailable");
  });
});

describe("GET /api/ask/:id", () => {
  test("resolves a short (suffix) id and reports live sessionStatus", async () => {
    const { launcher } = createFakeAskLauncher({ status: "blocked" });
    const { app } = createTestApp({ askLauncher: launcher });
    const created = await json(await postAsk(app));

    const res = await app.request(`/api/ask/${created.id.slice(-8)}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.id).toBe(created.id);
    expect(body.sessionStatus).toBe("blocked");
  });

  test("404 for an unknown id", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/ask/does-not-exist-1234");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/ask/for-file", () => {
  test("returns matches for asks anchored in the given path", async () => {
    const { launcher } = createFakeAskLauncher();
    const { app } = createTestApp({ askLauncher: launcher });
    await postAsk(app);

    const res = await app.request("/api/ask/for-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: "/repo",
        worktreeRoot: "/repo",
        path: "src/a.ts",
        lines: ["line0", "const x = 1;", "line2"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].startLine).toBe(2);
  });
});
