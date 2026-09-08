import { describe, expect, test } from "bun:test";
import type { HwClient } from "../client";
import type { CommandDeps } from "./types";
import { EXIT_OK, EXIT_USAGE } from "./types";
import { worktreeUseCommand } from "./worktree-use";

function fakeClient(setWorktreeOverride: HwClient["setWorktreeOverride"]): HwClient {
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
    clearWorktreeOverride: notImplemented,
    setWorktreeOverride,
  } as unknown as HwClient;
}

function baseDeps(client: HwClient, env: Record<string, string | undefined> = {}): CommandDeps {
  return { client, env, cwd: "/repo", readStdin: () => Promise.resolve("") };
}

describe("worktreeUseCommand", () => {
  // 無いと壊れる: 相対パスをそのままサーバーに送ると、サーバー側の cwd を基準に
  // 解決されてしまい、CLI を実行した場所と違う worktree が宣言される。
  test("resolves a relative path against the CLI's cwd before sending it", async () => {
    const calls: { pane: string; root: string }[] = [];
    const client = fakeClient((pane, root) => {
      calls.push({ pane, root });
      return Promise.resolve({ ok: true, value: { pane, root } });
    });
    const result = await worktreeUseCommand(
      ["../other-wt"],
      baseDeps(client, { HERDR_PANE_ID: "p1" }),
    );
    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual([{ pane: "p1", root: "/other-wt" }]);
    expect(result.stdout).toBe("worktree: /other-wt\n");
  });

  test("defaults path to cwd and pane to $HERDR_PANE_ID", async () => {
    const calls: { pane: string; root: string }[] = [];
    const client = fakeClient((pane, root) => {
      calls.push({ pane, root });
      return Promise.resolve({ ok: true, value: { pane, root } });
    });
    const result = await worktreeUseCommand([], baseDeps(client, { HERDR_PANE_ID: "p1" }));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual([{ pane: "p1", root: "/repo" }]);
  });

  // 無いと壊れる: pane を特定できないまま送信すると、サーバー側で常に
  // pane_not_found の 404 になり、意味のあるエラーメッセージが出ない。
  test("requires --pane or $HERDR_PANE_ID", async () => {
    const client = fakeClient(() => {
      throw new Error("must not be called");
    });
    const result = await worktreeUseCommand(["/some/path"], baseDeps(client, {}));
    expect(result.exitCode).toBe(EXIT_USAGE);
  });
});
