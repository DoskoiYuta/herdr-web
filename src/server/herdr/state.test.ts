import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import { applyEvent, describeChange, emptyState, stateFromSnapshot } from "./state";
import { createFakeHerdr } from "./fake";
import { createHerdrState } from "./state";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

/** Flushes both the replay-settle timer (scheduled via real `setTimeout`, 0ms in
 * these tests) and the microtasks `loadSnapshot`'s await chain needs after it fires. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("stateFromSnapshot", () => {
  test("indexes panes/workspaces/tabs and records focus from the real snapshot fixture", () => {
    const state = stateFromSnapshot(snapshot);
    expect(state.panes.size).toBe(snapshot.panes.length);
    expect(state.workspaces.size).toBe(snapshot.workspaces.length);
    expect(state.tabs.size).toBe(snapshot.tabs.length);
    expect(state.focusedPaneId).toBe(snapshot.focused_pane_id ?? null);
  });
});

describe("applyEvent", () => {
  test("pane_updated replaces the pane record", () => {
    const state = stateFromSnapshot(snapshot);
    const paneId = snapshot.panes[0]!.pane_id;
    const updated = { ...snapshot.panes[0]!, foreground_cwd: "/tmp/somewhere" };
    const next = applyEvent(state, {
      event: "pane_updated",
      data: { type: "pane_updated", pane: updated },
    });
    expect(next.panes.get(paneId)?.foreground_cwd).toBe("/tmp/somewhere");
    // purity: original state untouched
    expect(state.panes.get(paneId)?.foreground_cwd).toBe(snapshot.panes[0]!.foreground_cwd);
  });

  test("pane_updated without agent_session and with agent_status unknown keeps the agent fields the store already has", () => {
    // herdr's pane.updated payload omits agent_session and reports agent_status
    // "unknown" even while pane.get says idle + session (observed with herdr 0.8.2).
    const state = stateFromSnapshot(snapshot);
    const base = snapshot.panes.find((p) => p.agent)!;
    const seeded = applyEvent(state, {
      event: "pane_updated",
      data: {
        type: "pane_updated",
        pane: {
          ...base,
          agent_status: "idle",
          agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: "sess-1" },
        },
      },
    });
    const { agent_session: _omitted, ...partial } = base;
    const next = applyEvent(seeded, {
      event: "pane_updated",
      data: {
        type: "pane_updated",
        pane: { ...partial, agent_status: "unknown", label: "renamed" },
      },
    });
    const pane = next.panes.get(base.pane_id)!;
    expect(pane.label).toBe("renamed");
    expect(pane.agent_status).toBe("idle");
    expect(pane.agent_session?.value).toBe("sess-1");
  });

  test("pane_closed removes the pane and clears focus if it was focused", () => {
    const state = stateFromSnapshot(snapshot);
    const paneId = snapshot.focused_pane_id!;
    const next = applyEvent(state, {
      event: "pane_closed",
      data: {
        type: "pane_closed",
        pane_id: paneId,
        workspace_id: snapshot.workspaces[0]!.workspace_id,
      },
    });
    expect(next.panes.has(paneId)).toBe(false);
    expect(next.focusedPaneId).toBeNull();
  });

  test("pane_focused updates focusedPaneId and focusedWorkspaceId", () => {
    const state = stateFromSnapshot(snapshot);
    const otherPane = snapshot.panes.find((p) => p.pane_id !== snapshot.focused_pane_id)!;
    const next = applyEvent(state, {
      event: "pane_focused",
      data: {
        type: "pane_focused",
        pane_id: otherPane.pane_id,
        workspace_id: otherPane.workspace_id,
      },
    });
    expect(next.focusedPaneId).toBe(otherPane.pane_id);
    expect(next.focusedWorkspaceId).toBe(otherPane.workspace_id);
  });

  test("workspace_renamed updates the label in place", () => {
    const state = stateFromSnapshot(snapshot);
    const ws = snapshot.workspaces[0]!;
    const next = applyEvent(state, {
      event: "workspace_renamed",
      data: { type: "workspace_renamed", workspace_id: ws.workspace_id, label: "renamed" },
    });
    expect(next.workspaces.get(ws.workspace_id)?.label).toBe("renamed");
  });

  test("unknown-target rename is a no-op, not a throw", () => {
    const state = stateFromSnapshot(snapshot);
    const next = applyEvent(state, {
      event: "tab_renamed",
      data: { type: "tab_renamed", tab_id: "does-not-exist", workspace_id: "nope", label: "x" },
    });
    expect(next).toEqual(state);
  });

  test("pane_agent_detected with agent null clears the pane's agent and session", () => {
    const state = stateFromSnapshot(snapshot);
    const pane = snapshot.panes[0]!;
    const next = applyEvent(state, {
      event: "pane_agent_detected",
      data: {
        type: "pane_agent_detected",
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        agent: null,
        final_status: "unknown",
        released: true,
      },
    });
    const updated = next.panes.get(pane.pane_id)!;
    expect(updated.agent).toBeNull();
    expect(updated.agent_session).toBeNull();
    expect(updated.agent_status).toBe("unknown");
  });

  test("pane_agent_detected for an unknown pane is a no-op", () => {
    const state = stateFromSnapshot(snapshot);
    const next = applyEvent(state, {
      event: "pane_agent_detected",
      data: {
        type: "pane_agent_detected",
        pane_id: "does-not-exist",
        workspace_id: "nope",
        agent: null,
        released: true,
      },
    });
    expect(next).toEqual(state);
  });

  // Reproduces the ghost-workspace bug: herdr's cleanup can close a workspace
  // and then (event ordering isn't guaranteed) still deliver stray updates
  // for ids that belong to it — those must not resurrect it.
  test("updates for a workspace/pane closed earlier don't resurrect them", () => {
    const workspace = {
      workspace_id: "ws1",
      number: 1,
      label: "ask:1234",
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: "tab1",
      agent_status: "unknown" as const,
      worktree: null,
    };
    const tab = {
      tab_id: "tab1",
      workspace_id: "ws1",
      number: 1,
      label: "tab",
      focused: false,
      pane_count: 1,
      agent_status: "unknown" as const,
    };
    const pane = {
      pane_id: "pane1",
      terminal_id: "term1",
      workspace_id: "ws1",
      tab_id: "tab1",
      focused: false,
      agent_status: "unknown" as const,
      revision: 1,
      agent: null,
      agent_session: null,
      cwd: null,
      foreground_cwd: null,
      label: null,
      terminal_title: null,
      terminal_title_stripped: null,
      title: null,
    };

    let state = emptyState();
    state = applyEvent(state, {
      event: "workspace_created",
      data: { type: "workspace_created", workspace },
    });
    state = applyEvent(state, { event: "tab_created", data: { type: "tab_created", tab } });
    state = applyEvent(state, { event: "pane_created", data: { type: "pane_created", pane } });
    state = applyEvent(state, {
      event: "workspace_closed",
      data: { type: "workspace_closed", workspace_id: "ws1", workspace: null },
    });

    state = applyEvent(state, {
      event: "pane_updated",
      data: { type: "pane_updated", pane: { ...pane, label: "late update" } },
    });
    state = applyEvent(state, {
      event: "workspace_updated",
      data: { type: "workspace_updated", workspace: { ...workspace, label: "late update" } },
    });

    expect(state.workspaces.has("ws1")).toBe(false);
    expect(state.tabs.has("tab1")).toBe(false);
    expect(state.panes.has("pane1")).toBe(false);
  });

  // herdr 0.8.2's live event order for a new workspace is pane_created ->
  // workspace_created -> tab_created (not creation order) — without accepting
  // pane_created/tab_created before their workspace is known, every new
  // workspace's first pane is silently dropped from the tree.
  test("live order pane_created -> workspace_created -> tab_created yields a state with the pane under its workspace", () => {
    const workspace = {
      workspace_id: "ws2",
      number: 2,
      label: "ask:live",
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: "tab2",
      agent_status: "unknown" as const,
      worktree: null,
    };
    const tab = {
      tab_id: "tab2",
      workspace_id: "ws2",
      number: 1,
      label: "tab",
      focused: false,
      pane_count: 1,
      agent_status: "unknown" as const,
    };
    const pane = {
      pane_id: "pane3",
      terminal_id: "term3",
      workspace_id: "ws2",
      tab_id: "tab2",
      focused: false,
      agent_status: "unknown" as const,
      revision: 1,
      agent: null,
      agent_session: null,
      cwd: null,
      foreground_cwd: null,
      label: null,
      terminal_title: null,
      terminal_title_stripped: null,
      title: null,
    };

    let state = emptyState();
    state = applyEvent(state, { event: "pane_created", data: { type: "pane_created", pane } });
    state = applyEvent(state, {
      event: "workspace_created",
      data: { type: "workspace_created", workspace },
    });
    state = applyEvent(state, { event: "tab_created", data: { type: "tab_created", tab } });

    expect(state.panes.get("pane3")?.workspace_id).toBe("ws2");
    expect(state.workspaces.has("ws2")).toBe(true);
    expect(state.tabs.has("tab2")).toBe(true);
  });

  test("pane_agent_status_changed updates agent_status and, when carried, agent", () => {
    const state = stateFromSnapshot(snapshot);
    const pane = snapshot.panes[0]!;
    const next = applyEvent(state, {
      event: "pane_agent_status_changed",
      data: {
        type: "pane_agent_status_changed",
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        agent_status: "blocked",
        agent: null,
      },
    });
    const updated = next.panes.get(pane.pane_id)!;
    expect(updated.agent_status).toBe("blocked");
    expect(updated.agent).toBeNull();
  });
});

describe("describeChange", () => {
  test("pane_updated -> pane change", () => {
    const c = describeChange({
      event: "pane_updated",
      data: { type: "pane_updated", pane: snapshot.panes[0]! },
    });
    expect(c).toEqual({ kind: "pane", paneId: snapshot.panes[0]!.pane_id });
  });

  test("pane_closed -> pane-removed", () => {
    const c = describeChange({
      event: "pane_closed",
      data: { type: "pane_closed", pane_id: "p1", workspace_id: "w1" },
    });
    expect(c).toEqual({ kind: "pane-removed", paneId: "p1" });
  });

  test("pane_focused / workspace_focused / tab_focused -> focus", () => {
    expect(
      describeChange({
        event: "pane_focused",
        data: { type: "pane_focused", pane_id: "p1", workspace_id: "w1" },
      }),
    ).toEqual({ kind: "focus" });
    expect(
      describeChange({
        event: "workspace_focused",
        data: { type: "workspace_focused", workspace_id: "w1" },
      }),
    ).toEqual({ kind: "focus" });
  });

  test("layout_updated -> none", () => {
    expect(describeChange({ event: "layout_updated", data: { type: "layout_updated" } })).toEqual({
      kind: "none",
    });
  });
});

describe("createHerdrState", () => {
  test("loads the snapshot on connect and notifies reset", async () => {
    const gw = createFakeHerdr(snapshot);
    const changes: string[] = [];
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    store.onChange((c) => changes.push(c.kind));
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);
    expect(changes).toContain("reset");
  });

  test("applies subsequent events and notifies with a granular change", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));
    const paneId = snapshot.panes[0]!.pane_id;
    gw.setForegroundCwd(paneId, "/tmp/new-cwd");
    expect(store.get().panes.get(paneId)?.foreground_cwd).toBe("/tmp/new-cwd");
    expect(changes).toContainEqual({ kind: "pane", paneId });
  });

  test("re-snapshots on reconnect", async () => {
    const gw = createFakeHerdr(snapshot);
    gw.setStatus({ connected: false, protocol: null });
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    expect(store.get().panes.size).toBe(0);
    gw.closePane(snapshot.panes[1]!.pane_id);
    gw.setStatus({ connected: true, protocol: 20 });
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length - 1);
  });

  test("an agent lifecycle event re-reads the pane from herdr, so fields the event omits (session, status) still land", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    const pane = snapshot.panes[0]!;
    gw.setPaneSilently(pane.pane_id, {
      agent: "claude",
      agent_status: "idle",
      agent_session: { source: "herdr:claude", agent: "claude", kind: "id", value: "sess-1" },
    });

    gw.emit({
      event: "pane_agent_status_changed",
      data: {
        type: "pane_agent_status_changed",
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        agent_status: "idle",
      },
    });
    await settle();
    expect(store.get().panes.get(pane.pane_id)?.agent_session?.value).toBe("sess-1");
  });

  test("patchPane merges the pane into the store and notifies a pane change", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    const paneId = snapshot.panes[0]!.pane_id;
    const existing = store.get().panes.get(paneId)!;

    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));

    store.patchPane({ ...existing, foreground_cwd: "/patched/cwd" });

    expect(store.get().panes.get(paneId)?.foreground_cwd).toBe("/patched/cwd");
    expect(changes).toContainEqual({ kind: "pane", paneId });
  });

  // Minor fix: on disconnect, the store must drop its snapshot immediately —
  // otherwise a notifier reading `state.get().panes` could target a pane that
  // no longer exists (a "ghost pane") until the next reconnect's snapshot.
  test("on disconnect, resets the store to empty and notifies reset", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);

    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));
    gw.setStatus({ connected: false, protocol: null });

    expect(store.get().panes.size).toBe(0);
    expect(store.get().focusedPaneId).toBeNull();
    expect(changes).toContainEqual({ kind: "reset" });
  });
});

// herdr 0.8.2's events.subscribe replays a buffer of past events right after
// (re)connect, out of chronological order, with no way to opt out (see
// HerdrStateOptions.replaySettleMs in state.ts). These tests use small
// real-timer windows (well under bun's default test timeout) instead of a
// fake clock, since createHerdrState only depends on the ambient setTimeout.
describe("createHerdrState replay window", () => {
  const ghostWorkspace = {
    workspace_id: "ghost-ws",
    number: 999,
    label: "ask:ghost",
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "ghost-tab",
    agent_status: "unknown" as const,
  };
  const ghostTab = {
    tab_id: "ghost-tab",
    workspace_id: "ghost-ws",
    number: 1,
    label: "1",
    focused: false,
    pane_count: 1,
    agent_status: "unknown" as const,
  };
  const ghostPane = {
    pane_id: "ghost-pane",
    terminal_id: "ghost-term",
    workspace_id: "ghost-ws",
    tab_id: "ghost-tab",
    focused: false,
    agent_status: "unknown" as const,
    revision: 0,
  };

  // Without this, a replayed workspace_created for an already-closed workspace
  // resurrects it (the ghost-workspace bug: a closed `ask:*` workspace lingers
  // in the sidebar under 「質問セッション」until the next reconnect).
  test("events replayed right after connect for a workspace absent from the snapshot are discarded once the window settles", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 20, replayMaxMs: 1000 });

    gw.emit({
      event: "workspace_created",
      data: { type: "workspace_created", workspace: ghostWorkspace },
    });
    gw.emit({ event: "tab_created", data: { type: "tab_created", tab: ghostTab } });
    gw.emit({ event: "pane_created", data: { type: "pane_created", pane: ghostPane } });

    await new Promise((r) => setTimeout(r, 60));
    await settle();

    expect(store.get().workspaces.has("ghost-ws")).toBe(false);
    expect(store.get().panes.has("ghost-pane")).toBe(false);
    expect(store.get().panes.size).toBe(snapshot.panes.length);
  });

  // Without this, the fix could over-suppress and the sidebar would stop
  // reflecting real changes once herdr has been up for a while.
  test("a pane_created delivered after the window has settled is applied", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 20, replayMaxMs: 1000 });
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);

    const created = await gw.workspaceCreate({ cwd: "/tmp/live", label: "live-ws" });
    await settle();

    expect(store.get().workspaces.has(created.workspace_id)).toBe(true);
  });

  // Without this, a herdr restart (disconnect + reconnect) would replay its
  // history straight into the store on the new connection too.
  test("on reconnect (status false -> true) the replay window starts again, discarding what arrives right after", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw, undefined, { replaySettleMs: 20, replayMaxMs: 1000 });
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);

    gw.setStatus({ connected: false, protocol: null });
    gw.setStatus({ connected: true, protocol: 20 });
    gw.emit({
      event: "workspace_created",
      data: { type: "workspace_created", workspace: ghostWorkspace },
    });

    await new Promise((r) => setTimeout(r, 60));
    await settle();

    expect(store.get().workspaces.has("ghost-ws")).toBe(false);
    expect(store.get().panes.size).toBe(snapshot.panes.length);
  });
});
