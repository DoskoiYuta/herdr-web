import { describe, expect, test } from "bun:test";
import type { HwClient } from "../client";
import type { CommandDeps } from "./types";
import { EXIT_OK } from "./types";
import { extractWorktreePath, worktreeSyncCommand } from "./worktree-sync";

function fakeClient(overrides: Partial<HwClient> = {}): HwClient {
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
    clearWorktreeOverride: notImplemented,
    ...overrides,
  } as unknown as HwClient;
}

function depsWithStdin(stdin: string, client: HwClient): CommandDeps {
  return {
    client,
    env: { HERDR_PANE_ID: "p1" },
    cwd: "/repo",
    readStdin: () => Promise.resolve(stdin),
  };
}

describe("extractWorktreePath", () => {
  const isGitPathTrue = () => Promise.resolve(true);
  const isGitPathFalse = () => Promise.resolve(false);

  // Claude Code's hook cwd DOES follow EnterWorktree (unlike a shell hook's
  // cwd), so it's the first choice — but only once confirmed to actually be a
  // git path, so a stale/unrelated cwd never wins over a real tool_response.
  test("prefers hook.cwd over tool_response once it resolves as a git path", async () => {
    const path = await extractWorktreePath(
      { cwd: "/repo/wt", tool_response: { path: "/other" } },
      isGitPathTrue,
    );
    expect(path).toBe("/repo/wt");
  });

  test("falls back to tool_response.path/worktreePath/cwd, in that order, when hook.cwd isn't a git path", async () => {
    expect(
      await extractWorktreePath({ tool_response: { path: "/a" }, cwd: "/z" }, isGitPathFalse),
    ).toBe("/a");
    expect(
      await extractWorktreePath(
        { tool_response: { worktreePath: "/b" }, cwd: "/z" },
        isGitPathFalse,
      ),
    ).toBe("/b");
    expect(
      await extractWorktreePath({ tool_response: { cwd: "/c" }, cwd: "/z" }, isGitPathFalse),
    ).toBe("/c");
  });

  test("extracts an absolute path out of a bare string tool_response", async () => {
    const path = await extractWorktreePath(
      { tool_response: "worktree ready at /some/wt", cwd: "/z" },
      isGitPathFalse,
    );
    expect(path).toBe("/some/wt");
  });

  // 無いと壊れる: これが無いと本体 cwd（= main のまま）がそのまま宣言されて
  // しまい、誤宣言はサーバー側 no-op に頼るしかなくなる（route.test.ts 側の
  // フォールバックであって、ここで拾えるものはここで拾うべき）。
  test("returns null when hook.cwd isn't a git path and tool_response has no usable path", async () => {
    expect(await extractWorktreePath({ tool_response: {}, cwd: "/z" }, isGitPathFalse)).toBeNull();
    expect(await extractWorktreePath({ cwd: "/z" }, isGitPathFalse)).toBeNull();
    expect(await extractWorktreePath({}, isGitPathFalse)).toBeNull();
  });
});

describe("worktreeSyncCommand", () => {
  // 無いと壊れる: EnterWorktree で hw worktree use が呼ばれず、ツール領域が
  // 新しい worktree に追従しない。
  test("EnterWorktree declares the extracted path as the pane's worktree", async () => {
    const calls: { pane: string; root: string }[] = [];
    const client = fakeClient({
      setWorktreeOverride: (pane, root) => {
        calls.push({ pane, root });
        return Promise.resolve({ ok: true, value: { pane, root } });
      },
    });
    const hook = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "EnterWorktree",
      tool_response: { path: "/wt/new" },
      cwd: "/repo",
    });
    const result = await worktreeSyncCommand([], depsWithStdin(hook, client));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual([{ pane: "p1", root: "/wt/new" }]);
  });

  // 無いと壊れる: ExitWorktree で hw worktree clear が呼ばれず、worktree を
  // 出た後もツール領域が古い worktree に固定されたままになる。
  test("ExitWorktree clears the pane's worktree override", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      clearWorktreeOverride: (pane) => {
        calls.push(pane);
        return Promise.resolve({ ok: true, value: { pane, root: "/repo" } });
      },
    });
    const hook = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "ExitWorktree" });
    const result = await worktreeSyncCommand([], depsWithStdin(hook, client));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(calls).toEqual(["p1"]);
  });

  test("any other tool_name calls neither use nor clear", async () => {
    const client = fakeClient({
      setWorktreeOverride: () => {
        throw new Error("must not be called");
      },
      clearWorktreeOverride: () => {
        throw new Error("must not be called");
      },
    });
    const hook = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash" });
    const result = await worktreeSyncCommand([], depsWithStdin(hook, client));
    expect(result.exitCode).toBe(EXIT_OK);
  });

  // 無いと壊れる: hook はエージェントの作業を止めてはいけない。失敗時に非 0
  // で終了すると Claude Code のツール呼び出し自体をブロックしてしまう。
  test("exits 0 even when the server call fails", async () => {
    const client = fakeClient({
      setWorktreeOverride: () =>
        Promise.resolve({ ok: false, error: { kind: "network", message: "unreachable" } }),
    });
    const hook = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "EnterWorktree",
      tool_response: { path: "/wt/new" },
    });
    const result = await worktreeSyncCommand([], depsWithStdin(hook, client));
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stderr).toContain("unreachable");
  });

  test("exits 0 on invalid hook JSON", async () => {
    const client = fakeClient();
    const result = await worktreeSyncCommand([], depsWithStdin("not json", client));
    expect(result.exitCode).toBe(EXIT_OK);
  });

  test("exits 0 when no pane can be resolved", async () => {
    const client = fakeClient();
    const deps: CommandDeps = {
      client,
      env: {},
      cwd: "/repo",
      readStdin: () => Promise.resolve("{}"),
    };
    const result = await worktreeSyncCommand([], deps);
    expect(result.exitCode).toBe(EXIT_OK);
  });
});
