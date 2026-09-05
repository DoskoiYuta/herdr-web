import { describe, expect, test } from "bun:test";
import type { AskSession } from "../../contract/ask";
import { createHerdrAskLauncher } from "./ask-session";
import { createFakeHerdr } from "./fake";
import { createHerdrState } from "./state";

const emptySnapshot = {
  agents: [],
  panes: [],
  tabs: [],
  workspaces: [],
  focused_pane_id: null,
  focused_tab_id: null,
  focused_workspace_id: null,
  protocol: 20,
  version: "test",
};

const logger = { warn() {}, error() {} };

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function makeLauncher(maxSessions = 3) {
  const fake = createFakeHerdr(emptySnapshot);
  const state = createHerdrState(fake, logger, { replaySettleMs: 0, replayMaxMs: 0 });
  // createHerdrState's initial session.snapshot load is async (fires on
  // construction); let it settle before tests start emitting further events,
  // otherwise it can race and clobber state applied via those events.
  await settle();
  const launcher = createHerdrAskLauncher({
    gateway: fake,
    state,
    config: { maxSessions },
    hwBinDir: "/fake/hw-bin",
    hwUrl: "http://127.0.0.1:8080",
    logger,
  });
  return { fake, state, launcher };
}

describe("createHerdrAskLauncher.start", () => {
  test("creates a workspace, starts claude, and prompts it with the given text", async () => {
    const { fake, launcher } = await makeLauncher();
    const prompted: { pane: string; text: string }[] = [];
    const originalPrompt = fake.agentPrompt.bind(fake);
    fake.agentPrompt = async (pane, text) => {
      prompted.push({ pane, text });
      return originalPrompt(pane, text);
    };

    const result = await launcher.start({
      askId: "a1",
      worktreeRoot: "/repo",
      label: "ask:abc12345",
      prompt: "please look at this",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ kind: "herdr", label: "ask:abc12345" });

    const snapshot = await fake.snapshot();
    const workspace = snapshot.workspaces.find((w) => w.label === "ask:abc12345");
    expect(workspace).toBeTruthy();
    const pane = snapshot.panes.find((p) => p.workspace_id === workspace!.workspace_id);
    expect(pane?.agent).toBe("claude");
    expect(prompted).toEqual([{ pane: pane!.pane_id, text: "please look at this" }]);
  });

  // Without this, the claude session herdr spawns has no way to find `hw` and
  // no way to know which herdr-web instance to talk to, so it can never reply.
  test("creates the workspace with PATH prefixed by the hw bin dir and HW_URL set", async () => {
    const { fake, launcher } = await makeLauncher();
    const originalCreate = fake.workspaceCreate.bind(fake);
    let seenEnv: Record<string, string> | undefined;
    fake.workspaceCreate = async (params) => {
      seenEnv = params.env;
      return originalCreate(params);
    };

    await launcher.start({
      askId: "a5",
      worktreeRoot: "/repo",
      label: "ask:envcheck",
      prompt: "hi",
    });

    expect(seenEnv?.PATH?.startsWith("/fake/hw-bin")).toBe(true);
    expect(seenEnv?.HW_URL).toBe("http://127.0.0.1:8080");
  });

  test("returns limit_reached without creating a workspace once maxSessions ask: workspaces are live", async () => {
    const { fake, launcher } = await makeLauncher(1);
    await fake.workspaceCreate({ cwd: "/repo", label: "ask:existing" });
    const before = (await fake.snapshot()).workspaces.length;

    const result = await launcher.start({
      askId: "a2",
      worktreeRoot: "/repo",
      label: "ask:new",
      prompt: "hi",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: "limit_reached", limit: 1 });
    expect((await fake.snapshot()).workspaces.length).toBe(before);
  });

  test("returns herdr_unavailable when not connected", async () => {
    const { fake, launcher } = await makeLauncher();
    fake.setStatus({ connected: false, protocol: null });

    const result = await launcher.start({
      askId: "a3",
      worktreeRoot: "/repo",
      label: "ask:down",
      prompt: "hi",
    });

    expect(result._unsafeUnwrapErr()).toEqual({ type: "herdr_unavailable" });
  });

  test("closes the workspace again when agent.start fails after creation", async () => {
    const { fake, launcher } = await makeLauncher();
    const before = (await fake.snapshot()).workspaces.length;
    fake.agentStart = async () => {
      throw new Error("herdr: pane not at a shell prompt");
    };

    const result = await launcher.start({
      askId: "a4",
      worktreeRoot: "/repo",
      label: "ask:fails",
      prompt: "hi",
    });

    expect(result.isErr()).toBe(true);
    const errValue = result._unsafeUnwrapErr();
    expect(errValue.type).toBe("failed");
    expect((await fake.snapshot()).workspaces.length).toBe(before);
  });
});

describe("createHerdrAskLauncher session operations", () => {
  async function startSession(
    launcher: Awaited<ReturnType<typeof makeLauncher>>["launcher"],
    label: string,
  ) {
    const result = await launcher.start({ askId: "a", worktreeRoot: "/repo", label, prompt: "q" });
    return result._unsafeUnwrap();
  }

  test("prompt/status/close re-resolve the session by label after herdr compacts workspace ids", async () => {
    const { fake, launcher } = await makeLauncher();
    const label = "ask:compact01";
    const session = await startSession(launcher, label);

    // Simulate herdr's id compaction: the workspace closes and a new one with a
    // different id gets created (e.g. another workspace was closed first, so
    // ids shifted) — the session must still be found by its label alone.
    const before = await fake.snapshot();
    const oldWorkspaceId = before.workspaces.find((w) => w.label === label)!.workspace_id;
    await fake.workspaceClose(oldWorkspaceId);
    const recreated = await fake.workspaceCreate({ cwd: "/repo", label });
    expect(recreated.workspace_id).not.toBe(oldWorkspaceId);

    const promptResult = await launcher.prompt(session, "still here?");
    expect(promptResult.isOk()).toBe(true);

    const status = await launcher.status(session);
    expect(status).not.toBe("gone");

    await launcher.close(session);
    expect((await fake.snapshot()).workspaces.some((w) => w.label === label)).toBe(false);
  });

  test("prompt/status report gone once the session's workspace no longer exists", async () => {
    const { launcher } = await makeLauncher();
    const session: AskSession = { kind: "herdr", label: "ask:never-existed" };

    expect((await launcher.prompt(session, "hi"))._unsafeUnwrapErr()).toEqual({ type: "gone" });
    expect(await launcher.status(session)).toBe("gone");
    await expect(launcher.close(session)).resolves.toBeUndefined();
  });

  test("prompt maps herdr's agent_blocked rejection to a typed error", async () => {
    const { fake, launcher } = await makeLauncher();
    const label = "ask:blocked01";
    const session = await startSession(launcher, label);
    const workspace = (await fake.snapshot()).workspaces.find((w) => w.label === label)!;
    const pane = (await fake.snapshot()).panes.find(
      (p) => p.workspace_id === workspace.workspace_id,
    )!;
    fake.simulateAgentBlocked(pane.pane_id);

    const result = await launcher.prompt(session, "blocked?");
    expect(result._unsafeUnwrapErr()).toEqual({ type: "agent_blocked" });
  });
});
