import { describe, expect, test } from "bun:test";
import snapshotJson from "../../../contract/__fixtures__/snapshot.json";
import * as v from "valibot";
import { SessionSnapshotSchema } from "../../../contract/herdr";
import { createFakeHerdr } from "../../herdr/fake";
import { createHerdrState } from "../../herdr/state";
import type { WorktreeResolver } from "../../herdr/tree";
import { createHerdrNotifier } from "./herdr-notifier";

const snapshot = v.parse(SessionSnapshotSchema, snapshotJson);

function resolverFor(map: Record<string, string>): WorktreeResolver {
  return {
    async resolve(path) {
      const root = map[path];
      return root ? { root, commonDir: `${root}/.git`, branch: "main", isMain: true } : null;
    },
  };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
}

describe("createHerdrNotifier", () => {
  test("prompts the focused pane in the worktree, else the first agent pane, else no_target", async () => {
    const fake = createFakeHerdr(snapshot);
    const state = createHerdrState(fake, { error() {}, warn() {} });
    await settle();
    const panes = [...state.get().panes.values()].filter((p) => p.agent);
    expect(panes.length).toBeGreaterThan(1);
    const a = panes[0]!;
    const cwdA = a.foreground_cwd ?? a.cwd ?? "";
    // cwd の異なる pane を b にする（同じ cwd だと同じ worktree になる）
    const b = panes.find((p) => (p.foreground_cwd ?? p.cwd) !== cwdA)!;
    const cwdB = b.foreground_cwd ?? b.cwd ?? "";
    const resolver = resolverFor({ [cwdA]: "/wt/A", [cwdB]: "/wt/B" });
    const notifier = createHerdrNotifier({
      state,
      gateway: fake,
      resolver,
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    fake.focusPane(b.pane_id);
    await settle();
    expect(await notifier.notify({ worktreeRoot: "/wt/B", reviewIds: ["1", "2"] })).toEqual({
      result: "sent",
      pane: b.pane_id,
    });
    expect(await notifier.notify({ worktreeRoot: "/wt/A", reviewIds: ["1"] })).toEqual({
      result: "sent",
      pane: a.pane_id,
    });
    expect(await notifier.notify({ worktreeRoot: "/wt/none", reviewIds: ["1"] })).toEqual({
      result: "no_target",
      pane: null,
    });

    fake.simulateAgentBlocked(a.pane_id);
    expect(await notifier.notify({ worktreeRoot: "/wt/A", reviewIds: ["1"] })).toEqual({
      result: "agent_blocked",
      pane: a.pane_id,
    });
  });

  // without this test, notify's viaCommit fallback could regress and silently
  // deliver a review's prompt to an agent in a different workspace's worktree.
  test("a pane in another worktree is not a target, even for a worktree with no pane of its own", async () => {
    const fake = createFakeHerdr(snapshot);
    const state = createHerdrState(fake, { error() {}, warn() {} });
    await settle();
    const panes = [...state.get().panes.values()].filter((p) => p.agent);
    const a = panes[0]!;
    const cwdA = a.foreground_cwd ?? a.cwd ?? "";
    const resolver = resolverFor({ [cwdA]: "/wt/A" });
    const notifier = createHerdrNotifier({
      state,
      gateway: fake,
      resolver,
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    // "/wt/other" has no pane of its own, only "/wt/A" does — must still be no_target.
    expect(await notifier.notify({ worktreeRoot: "/wt/other", reviewIds: ["1"] })).toEqual({
      result: "no_target",
      pane: null,
    });
    expect(await notifier.targetsAt("/wt/other")).toEqual([]);
  });

  // without this test, sendDraftsUsecase's ambiguous_target/invalid_target checks
  // would have no way to enumerate real candidates before choosing one to notify.
  test("targetsAt returns only agent panes at the root, with the focused flag set", async () => {
    const paneA = {
      pane_id: "w1:pA",
      terminal_id: "t1",
      workspace_id: "w1",
      tab_id: "t1",
      focused: false,
      agent_status: "idle" as const,
      revision: 1,
      agent: "claude",
      cwd: "/wt/A",
    };
    const paneB = {
      pane_id: "w1:pB",
      terminal_id: "t2",
      workspace_id: "w1",
      tab_id: "t1",
      focused: false,
      agent_status: "idle" as const,
      revision: 1,
      agent: "claude",
      cwd: "/wt/B",
    };
    const state = {
      get: () => ({
        panes: new Map([
          [paneA.pane_id, paneA],
          [paneB.pane_id, paneB],
        ]),
        workspaces: new Map(),
        tabs: new Map(),
        focusedPaneId: paneA.pane_id,
        focusedWorkspaceId: null,
        focusedTabId: null,
        paneWorktreeOverrides: new Map(),
      }),
      onChange: () => () => {},
      patchPane: () => {},
      isSettled: () => true,
      setWorktreeOverride: () => ({ ok: true as const }),
      clearWorktreeOverride: () => {},
    };
    const notifier = createHerdrNotifier({
      state,
      gateway: { agentPrompt: async () => ({ status: "sent" as const }) } as unknown as Parameters<
        typeof createHerdrNotifier
      >[0]["gateway"],
      resolver: resolverFor({ "/wt/A": "/wt/A", "/wt/B": "/wt/B" }),
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    expect(await notifier.targetsAt("/wt/A")).toEqual([{ pane: paneA.pane_id, focused: true }]);
    expect(await notifier.targetsAt("/wt/B")).toEqual([{ pane: paneB.pane_id, focused: false }]);
  });

  // without this test, an explicit `pane` on send-drafts could silently fall
  // through to the "focused, else first" default instead of targeting exactly
  // the pane the caller resolved via targetsAt.
  test("an explicit pane is prompted exactly, even when it is not the focused pane", async () => {
    const fake = createFakeHerdr(snapshot);
    const state = createHerdrState(fake, { error() {}, warn() {} });
    await settle();
    const panes = [...state.get().panes.values()].filter((p) => p.agent);
    expect(panes.length).toBeGreaterThan(1);
    const a = panes[0]!;
    const b = panes.find((p) => p.pane_id !== a.pane_id)!;
    const cwdA = a.foreground_cwd ?? a.cwd ?? "";
    const cwdB = b.foreground_cwd ?? b.cwd ?? "";
    const resolver = resolverFor({ [cwdA]: "/wt/A", [cwdB]: "/wt/A" });
    const notifier = createHerdrNotifier({
      state,
      gateway: fake,
      resolver,
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    fake.focusPane(a.pane_id);
    await settle();
    expect(
      await notifier.notify({ worktreeRoot: "/wt/A", reviewIds: ["1"], pane: b.pane_id }),
    ).toEqual({
      result: "sent",
      pane: b.pane_id,
    });

    expect(
      await notifier.notify({ worktreeRoot: "/wt/A", reviewIds: ["1"], pane: "not-a-pane" }),
    ).toEqual({ result: "no_target", pane: null });
  });

  // without this test, a pane whose agent already exited would still be offered as
  // a send target — herdr's pane_agent_detected(agent: null) event was previously
  // dropped by applyEvent, so the pane's stale `agent: "claude"` lingered in state.
  test("a pane whose agent was cleared by pane_agent_detected is no longer a target", async () => {
    const fake = createFakeHerdr(snapshot);
    const state = createHerdrState(fake, { error() {}, warn() {} });
    await settle();
    const pane = [...state.get().panes.values()].find((p) => p.agent)!;
    const cwd = pane.foreground_cwd ?? pane.cwd ?? "";
    const resolver = resolverFor({ [cwd]: "/wt/A" });
    const notifier = createHerdrNotifier({
      state,
      gateway: fake,
      resolver,
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    expect(await notifier.targetsAt("/wt/A")).toContainEqual({
      pane: pane.pane_id,
      focused: pane.pane_id === state.get().focusedPaneId,
    });

    // herdr's pane.get reflects the exit before the event arrives
    fake.setPaneSilently(pane.pane_id, {
      agent: null,
      agent_session: null,
      agent_status: "unknown",
    });
    fake.emit({
      event: "pane_agent_detected",
      data: {
        type: "pane_agent_detected",
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        agent: null,
        released: true,
      },
    });
    await settle();

    expect(await notifier.targetsAt("/wt/A")).not.toContainEqual(
      expect.objectContaining({ pane: pane.pane_id }),
    );
  });

  // F7: a transport timeout must not be reported as agent_blocked — we don't actually
  // know whether herdr received/sent the prompt, so surface it as unknown instead.
  test("a gateway transport timeout resolves to unknown, not agent_blocked", async () => {
    const paneId = "w1:p1";
    const pane = {
      pane_id: paneId,
      terminal_id: "t1",
      workspace_id: "w1",
      tab_id: "t1",
      focused: false,
      agent_status: "idle" as const,
      revision: 1,
      agent: "claude",
      cwd: "/wt/A",
    };
    const state = {
      get: () => ({
        panes: new Map([[paneId, pane]]),
        workspaces: new Map(),
        tabs: new Map(),
        focusedPaneId: null,
        focusedWorkspaceId: null,
        focusedTabId: null,
        paneWorktreeOverrides: new Map(),
      }),
      onChange: () => () => {},
      patchPane: () => {},
      isSettled: () => true,
      setWorktreeOverride: () => ({ ok: true as const }),
      clearWorktreeOverride: () => {},
    };
    const gateway = {
      agentPrompt: async () => {
        throw new Error("herdr: request agent.prompt timed out after 60000ms");
      },
    } as unknown as Parameters<typeof createHerdrNotifier>[0]["gateway"];

    const notifier = createHerdrNotifier({
      state,
      gateway,
      resolver: resolverFor({ "/wt/A": "/wt/A" }),
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    expect(await notifier.notify({ worktreeRoot: "/wt/A", reviewIds: ["1"] })).toEqual({
      result: "unknown",
      pane: paneId,
    });
  });
});
