import { describe, expect, test } from "bun:test";
import type { ClientResult } from "../client";
import type { HwClient } from "../client";
import type { Ask } from "../../contract/ask";
import type { CommandDeps } from "./types";
import { EXIT_OK } from "./types";
import { askReplyCommand } from "./ask-reply";

function fakeAsk(): Ask {
  return {
    id: "ask-1",
    repo: "/repo",
    worktreeRoot: "/repo",
    path: "src/a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: null,
    status: "replied",
    session: null,
    thread: [],
    lastPrompt: null,
    createdAt: "t",
    updatedAt: "t",
  };
}

function fakeClient(replyToAsk: HwClient["replyToAsk"]): HwClient {
  const notImplemented = () => {
    throw new Error("not implemented in this fake");
  };
  return {
    health: notImplemented,
    whoami: notImplemented,
    listReviews: notImplemented,
    getReview: notImplemented,
    replyToReview: notImplemented,
    moveRepo: notImplemented,
    listAsks: notImplemented,
    getAsk: notImplemented,
    replyToAsk,
  } as unknown as HwClient;
}

describe("askReplyCommand", () => {
  test("posts the reply as author=agent", async () => {
    const calls: { id: string; body: string; agentSession: string | null }[] = [];
    const replyToAsk = (
      id: string,
      body: string,
      agentSession: string | null,
    ): Promise<ClientResult<Ask>> => {
      calls.push({ id, body, agentSession });
      return Promise.resolve({ ok: true, value: fakeAsk() });
    };
    const deps: CommandDeps = {
      client: fakeClient(replyToAsk),
      env: {},
      cwd: "/repo",
      readStdin: () => Promise.resolve(""),
    };

    const result = await askReplyCommand(["ask-1", "because", "of", "reasons"], deps);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual([{ id: "ask-1", body: "because of reasons", agentSession: null }]);
  });
});
