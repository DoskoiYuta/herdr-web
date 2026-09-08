import { describe, expect, test } from "bun:test";
import type { HwClient } from "../client";
import type { CommandDeps } from "./types";
import { EXIT_OK, EXIT_USAGE } from "./types";
import { worktreeClearCommand } from "./worktree-clear";

function fakeClient(clearWorktreeOverride: HwClient["clearWorktreeOverride"]): HwClient {
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
    replyToAsk: notImplemented,
    createDecision: notImplemented,
    setWorktreeOverride: notImplemented,
    clearWorktreeOverride,
  } as unknown as HwClient;
}

function baseDeps(client: HwClient, env: Record<string, string | undefined> = {}): CommandDeps {
  return { client, env, cwd: "/repo", readStdin: () => Promise.resolve("") };
}

describe("worktreeClearCommand", () => {
  test("clears the override for --pane or $HERDR_PANE_ID", async () => {
    const calls: string[] = [];
    const client = fakeClient((pane) => {
      calls.push(pane);
      return Promise.resolve({ ok: true, value: { pane, root: "/back/to/raw" } });
    });
    const result = await worktreeClearCommand([], baseDeps(client, { HERDR_PANE_ID: "p1" }));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual(["p1"]);
    expect(result.stdout).toBe("worktree: /back/to/raw\n");
  });

  test("requires --pane or $HERDR_PANE_ID", async () => {
    const client = fakeClient(() => {
      throw new Error("must not be called");
    });
    const result = await worktreeClearCommand([], baseDeps(client, {}));
    expect(result.exitCode).toBe(EXIT_USAGE);
  });
});
