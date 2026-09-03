import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import type { ServerEventMessage } from "../../contract/events";
import { createFakeHerdr } from "../herdr/fake";
import { createHerdrState } from "../herdr/state";
import { createFocusTracker } from "../herdr/focus";
import type { WorktreeInfo, WorktreeResolver } from "../herdr/tree";
import { createEventHub, wireHerdrToHub, type Sink } from "./broadcast";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function collectingSink(): Sink & { messages: ServerEventMessage[] } {
  const messages: ServerEventMessage[] = [];
  return {
    messages,
    send(m) {
      messages.push(m);
    },
  };
}

function resolverResolvingEverythingToItself(): WorktreeResolver {
  return {
    async resolve(cwd: string): Promise<WorktreeInfo> {
      return { root: cwd, commonDir: `${cwd}/.git`, branch: "main", isMain: true };
    },
  };
}

async function setup() {
  const gw = createFakeHerdr(snapshot);
  const state = createHerdrState(gw);
  await settle();
  const resolver = resolverResolvingEverythingToItself();
  const focus = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
  await settle();
  const hub = createEventHub();
  const wired = wireHerdrToHub({ state, gateway: gw, focus, resolver, hub });
  return { gw, state, focus, hub, wired };
}

describe("createEventHub", () => {
  test("broadcast reaches every attached sink, not detached ones", () => {
    const hub = createEventHub();
    const a = collectingSink();
    const b = collectingSink();
    const detachA = hub.attach(a);
    hub.attach(b);
    hub.broadcast({ type: "herdr", connected: true, protocol: 20 });
    detachA();
    hub.broadcast({ type: "herdr", connected: false, protocol: null });
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(2);
  });
});

describe("wireHerdrToHub", () => {
  test("sends tree, focus, and herdr status to a newly attached sink", async () => {
    const { hub } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    const types = sink.messages.map((m) => m.type);
    expect(types).toContain("tree");
    expect(types).toContain("focus");
    expect(types).toContain("herdr");
  });

  test("broadcasts a fresh tree on state reset", async () => {
    const { hub, gw } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    sink.messages.length = 0;
    gw.setStatus({ connected: false, protocol: null });
    gw.setStatus({ connected: true, protocol: 20 });
    await settle();
    expect(sink.messages.some((m) => m.type === "tree")).toBe(true);
  });

  test("broadcasts pane-updated when a pane changes", async () => {
    const { hub, gw, state } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    sink.messages.length = 0;
    const paneId = [...state.get().panes.keys()][0]!;
    gw.setForegroundCwd(paneId, "/tmp/changed");
    await settle();
    const msg = sink.messages.find((m) => m.type === "pane-updated");
    expect(msg).toBeDefined();
    if (msg?.type === "pane-updated") {
      expect(msg.row.paneId).toBe(paneId);
      expect(msg.worktreeRoot).toBe("/tmp/changed");
    }
  });

  test("broadcasts pane-removed when a pane closes", async () => {
    const { hub, gw, state } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    sink.messages.length = 0;
    const paneId = [...state.get().panes.keys()][0]!;
    gw.closePane(paneId);
    await settle();
    expect(sink.messages).toContainEqual({ type: "pane-removed", pane: paneId });
  });

  test("broadcasts focus when the focused pane changes", async () => {
    const { hub, gw, state } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    sink.messages.length = 0;
    const other = [...state.get().panes.values()].find(
      (p) => p.pane_id !== state.get().focusedPaneId,
    )!;
    gw.focusPane(other.pane_id);
    await settle();
    const msg = sink.messages.find((m) => m.type === "focus");
    expect(msg).toBeDefined();
    if (msg?.type === "focus") expect(msg.pane).toBe(other.pane_id);
  });

  test("broadcasts herdr on gateway status change", async () => {
    const { hub, gw } = await setup();
    const sink = collectingSink();
    hub.attach(sink);
    await settle();
    sink.messages.length = 0;
    gw.setStatus({ connected: false, protocol: null });
    expect(sink.messages).toContainEqual({ type: "herdr", connected: false, protocol: null });
  });

  test("handleClientMessage pin delegates to focus.pin", async () => {
    const { wired, focus, state } = await setup();
    const paneId = state.get().focusedPaneId!;
    const pane = state.get().panes.get(paneId)!;
    const cwd = pane.foreground_cwd ?? pane.cwd!;
    wired.handleClientMessage({ type: "pin", worktreeRoot: cwd });
    await settle();
    expect(focus.pinned()).toBe(cwd);
  });

  test("handleClientMessage focus-pane in the same workspace only calls pane.focus", async () => {
    const { wired, gw, state } = await setup();
    const focusedWorkspace = state.get().focusedWorkspaceId!;
    const samePane = [...state.get().panes.values()].find(
      (p) => p.workspace_id === focusedWorkspace && p.pane_id !== state.get().focusedPaneId,
    );
    if (!samePane) return; // fixture may only have one pane in the focused workspace
    let workspaceFocusCalled = false;
    const originalWorkspaceFocus = gw.workspaceFocus.bind(gw);
    gw.workspaceFocus = async (id: string) => {
      workspaceFocusCalled = true;
      return originalWorkspaceFocus(id);
    };
    wired.handleClientMessage({ type: "focus-pane", pane: samePane.pane_id });
    await settle();
    expect(workspaceFocusCalled).toBe(false);
    expect(state.get().focusedPaneId).toBe(samePane.pane_id);
  });

  test("handleClientMessage focus-pane across workspaces calls workspace.focus first (§12-9)", async () => {
    const { wired, state } = await setup();
    const focusedWorkspace = state.get().focusedWorkspaceId!;
    const otherWorkspacePane = [...state.get().panes.values()].find(
      (p) => p.workspace_id !== focusedWorkspace,
    );
    if (!otherWorkspacePane) return; // fixture guard
    wired.handleClientMessage({ type: "focus-pane", pane: otherWorkspacePane.pane_id });
    await settle();
    expect(state.get().focusedWorkspaceId).toBe(otherWorkspacePane.workspace_id);
    expect(state.get().focusedPaneId).toBe(otherWorkspacePane.pane_id);
  });
});
