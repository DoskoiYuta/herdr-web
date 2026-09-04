import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import { applyEvent, describeChange, stateFromSnapshot } from "./state";
import { createFakeHerdr } from "./fake";
import { createHerdrState } from "./state";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

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
    const store = createHerdrState(gw);
    store.onChange((c) => changes.push(c.kind));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().panes.size).toBe(snapshot.panes.length);
    expect(changes).toContain("reset");
  });

  test("applies subsequent events and notifies with a granular change", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
    await Promise.resolve();
    await Promise.resolve();
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
    const store = createHerdrState(gw);
    await Promise.resolve();
    expect(store.get().panes.size).toBe(0);
    gw.closePane(snapshot.panes[1]!.pane_id);
    gw.setStatus({ connected: true, protocol: 20 });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().panes.size).toBe(snapshot.panes.length - 1);
  });

  test("an agent lifecycle event re-reads the pane from herdr, so fields the event omits (session, status) still land", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
    await Promise.resolve();
    await Promise.resolve();
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
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(store.get().panes.get(pane.pane_id)?.agent_session?.value).toBe("sess-1");
  });

  test("patchPane merges the pane into the store and notifies a pane change", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
    await Promise.resolve();
    await Promise.resolve();
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
    const store = createHerdrState(gw);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().panes.size).toBe(snapshot.panes.length);

    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));
    gw.setStatus({ connected: false, protocol: null });

    expect(store.get().panes.size).toBe(0);
    expect(store.get().focusedPaneId).toBeNull();
    expect(changes).toContainEqual({ kind: "reset" });
  });
});
