import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import {
  applyEvent,
  describeChange,
  emptyState,
  selectionKey,
  stateFromSnapshot,
  type SelectionRepository,
  type ToolTabRepository,
  type WorkspaceSelection,
  type WorkspaceToolTab,
} from "./state";
import { createFakeHerdr, type FakeHerdr } from "./fake";
import { createHerdrState } from "./state";
import type { HerdrGateway } from "./gateway";
import type { SessionSnapshot } from "../../contract/herdr";

function inMemorySelectionRepo(): SelectionRepository & {
  rows: Map<string, WorkspaceSelection>;
} {
  const rows = new Map<string, WorkspaceSelection>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async set(sel) {
      rows.set(selectionKey(sel.workspaceId, sel.repoKey), sel);
    },
    async delete(workspaceId, repoKey) {
      rows.delete(selectionKey(workspaceId, repoKey));
    },
    async deleteByWorkspace(workspaceId) {
      for (const [key, sel] of rows) {
        if (sel.workspaceId === workspaceId) rows.delete(key);
      }
    },
  };
}

function inMemoryToolTabRepo(): ToolTabRepository & { rows: Map<string, WorkspaceToolTab> } {
  const rows = new Map<string, WorkspaceToolTab>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async set(toolTab) {
      rows.set(toolTab.workspaceId, toolTab);
    },
    async deleteByWorkspace(workspaceId) {
      rows.delete(workspaceId);
    },
  };
}

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

/** Flushes the microtasks `loadSnapshot`'s await chain needs to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Wraps a fake gateway so `snapshot()` doesn't resolve until `release()` is
 * called — used to exercise the window between subscribing and the
 * `session.snapshot` response landing.
 */
function withDelayedSnapshot(fake: FakeHerdr): { gateway: HerdrGateway; release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    gateway: {
      ...fake,
      snapshot: async (): Promise<SessionSnapshot> => {
        await gate;
        return fake.snapshot();
      },
    },
    release,
  };
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

  // 無いと壊れる: workspace を閉じても選択が残ると、同じ workspace_id が別の
  // ワークスペースに再利用されたときに無関係な worktree/サブリポジトリが
  // 復元されてしまう。
  test("workspace_closed drops that workspace's selections but not another workspace's", () => {
    const base = stateFromSnapshot(snapshot);
    const wsA = snapshot.workspaces[0]!.workspace_id;
    const selA: WorkspaceSelection = {
      workspaceId: wsA,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
      updatedAt: "t0",
    };
    const selOther: WorkspaceSelection = { ...selA, workspaceId: "other-ws" };
    const withSelections = {
      ...base,
      selections: new Map([
        [selectionKey(selA.workspaceId, selA.repoKey), selA],
        [selectionKey(selOther.workspaceId, selOther.repoKey), selOther],
      ]),
    };

    const next = applyEvent(withSelections, {
      event: "workspace_closed",
      data: { type: "workspace_closed", workspace_id: wsA, workspace: null },
    });

    expect(next.selections.has(selectionKey(wsA, selA.repoKey))).toBe(false);
    expect(next.selections.has(selectionKey("other-ws", selOther.repoKey))).toBe(true);
  });

  // 無いと壊れる: workspace を閉じても保存済みタブが残ると、同じ workspace_id
  // が別のワークスペースに再利用されたときに無関係なタブが復元されてしまう。
  test("workspace_closed drops that workspace's tool-tab but not another workspace's", () => {
    const base = stateFromSnapshot(snapshot);
    const wsA = snapshot.workspaces[0]!.workspace_id;
    const withToolTabs = {
      ...base,
      toolTabs: new Map<string, WorkspaceToolTab>([
        [wsA, { workspaceId: wsA, tab: "notes", updatedAt: "t0" }],
        ["other-ws", { workspaceId: "other-ws", tab: "graph", updatedAt: "t0" }],
      ]),
    };

    const next = applyEvent(withToolTabs, {
      event: "workspace_closed",
      data: { type: "workspace_closed", workspace_id: wsA, workspace: null },
    });

    expect(next.toolTabs.has(wsA)).toBe(false);
    expect(next.toolTabs.has("other-ws")).toBe(true);
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
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);
    expect(changes).toContain("reset");
  });

  test("applies subsequent events and notifies with a granular change", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
    await settle();
    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));
    const paneId = snapshot.panes[0]!.pane_id;
    gw.setForegroundCwd(paneId, "/tmp/new-cwd");
    expect(store.get().panes.get(paneId)?.foreground_cwd).toBe("/tmp/new-cwd");
    expect(changes).toContainEqual({ kind: "pane", paneId });
  });

  // Without this, a herdr restart leaves the sidebar stuck showing whatever
  // was true before the restart, and further changes never arrive.
  test("re-snapshots on reconnect and keeps applying events afterward", async () => {
    const gw = createFakeHerdr(snapshot);
    gw.setStatus({ connected: false, protocol: null });
    const store = createHerdrState(gw);
    await settle();
    expect(store.get().panes.size).toBe(0);
    gw.closePane(snapshot.panes[1]!.pane_id);
    gw.setStatus({ connected: true, protocol: 20 });
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length - 1);

    const created = await gw.workspaceCreate({ cwd: "/tmp/live", label: "live-ws" });
    await settle();
    expect(store.get().workspaces.has(created.workspace_id)).toBe(true);
  });

  // Without this, decision delivery (F13-9) could treat a pane as gone while
  // the snapshot request is still in flight, instead of waiting.
  test("isSettled is false until the snapshot loads, then true", async () => {
    const gw = createFakeHerdr(snapshot);
    const { gateway, release } = withDelayedSnapshot(gw);
    const store = createHerdrState(gateway);
    expect(store.isSettled()).toBe(false);
    release();
    await settle();
    expect(store.isSettled()).toBe(true);
  });

  test("an agent lifecycle event re-reads the pane from herdr, so fields the event omits (session, status) still land", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
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
    const store = createHerdrState(gw);
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
    const store = createHerdrState(gw);
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

describe("createHerdrState: worktree selections", () => {
  test("setSelection makes getSelection report it; clearSelection removes it", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemorySelectionRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();
    const workspaceId = snapshot.workspaces[0]!.workspace_id;

    store.setSelection({
      workspaceId,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    expect(store.getSelection(workspaceId, "/repo/.git")?.worktreeRoot).toBe("/repo");

    store.clearSelection(workspaceId, "/repo/.git");
    expect(store.getSelection(workspaceId, "/repo/.git")).toBeNull();
  });

  // 無いと壊れる: resolvePaneWorktree が確認済みの選択を再解決のたびに
  // setSelection し直すと、tree 再構築のたびに DB 書き込みと reset 通知が
  // 発生し続ける（setSelection 自体が reset を発火するため無限ループの温床になる）。
  test("setSelection with an identical (worktreeRoot, subRepoId, subWorktreeRoot) is a no-op: no persist, no notify", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemorySelectionRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();
    const workspaceId = snapshot.workspaces[0]!.workspace_id;
    store.setSelection({
      workspaceId,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    await settle();
    const before = repo.rows.get(`${workspaceId} /repo/.git`)!;

    const changes: import("./state").StateChange[] = [];
    store.onChange((c) => changes.push(c));
    store.setSelection({
      workspaceId,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    await settle();

    expect(changes).toEqual([]);
    expect(repo.rows.get(`${workspaceId} /repo/.git`)).toEqual(before); // updatedAt unchanged: no re-persist
  });

  // 無いと壊れる: closeWorkspace 後もサーバー再起動をまたいで選択が DB に残り、
  // 別の workspace が同じ workspace_id を再利用したときに誤って復元される。
  test("closing a workspace deletes its persisted selections", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemorySelectionRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();
    const workspaceId = snapshot.workspaces[0]!.workspace_id;
    store.setSelection({
      workspaceId,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    await settle();
    expect(repo.rows.size).toBe(1);

    gw.workspaceClose(workspaceId);
    await settle();
    expect(repo.rows.size).toBe(0);
  });

  // 無いと壊れる: bun --watch の再起動や herdr 再接続のたびに選択を失い、
  // 長いセッション中に何度もブラウザで選び直す羽目になる。
  test("survives a fresh store over the same repository, as long as the workspace still exists", async () => {
    const repo = inMemorySelectionRepo();
    const workspaceId = snapshot.workspaces[0]!.workspace_id;
    const first = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();
    first.setSelection({
      workspaceId,
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    await settle();

    const second = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();
    expect(second.getSelection(workspaceId, "/repo/.git")?.worktreeRoot).toBe("/repo");
  });

  // 無いと壊れる: サーバーが落ちている間に workspace が閉じられたケースを見逃し、
  // 存在しない workspace 宛の選択が DB にゴーストとして残り続ける。
  test("drops a persisted selection whose workspace no longer exists in the fresh snapshot", async () => {
    const repo = inMemorySelectionRepo();
    await repo.set({
      workspaceId: "gone-ws",
      repoKey: "/repo/.git",
      worktreeRoot: "/repo",
      subRepoId: null,
      subWorktreeRoot: null,
      updatedAt: "t0",
    });

    const store = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();

    expect(store.getSelection("gone-ws", "/repo/.git")).toBeNull();
    expect(repo.rows.size).toBe(0);
  });
});

describe("createHerdrState: tool-tab selection", () => {
  test("setToolTab makes getToolTab report it", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemoryToolTabRepo();
    const store = createHerdrState(gw, undefined, undefined, repo);
    await settle();
    const workspaceId = snapshot.workspaces[0]!.workspace_id;

    store.setToolTab(workspaceId, "notes");
    expect(store.getToolTab(workspaceId)?.tab).toBe("notes");
  });

  // 無いと壊れる: サーバーが落ちている間に workspace が閉じられたケースを見逃し、
  // 存在しない workspace 宛のタブが DB にゴーストとして残り続ける。
  test("drops a persisted tool-tab whose workspace no longer exists in the fresh snapshot", async () => {
    const repo = inMemoryToolTabRepo();
    await repo.set({ workspaceId: "gone-ws", tab: "notes", updatedAt: "t0" });

    const store = createHerdrState(createFakeHerdr(snapshot), undefined, undefined, repo);
    await settle();

    expect(store.getToolTab("gone-ws")).toBeNull();
    expect(repo.rows.size).toBe(0);
  });
});

// subscribe is established before `session.snapshot` is requested (see
// socket-client.ts), so a live event can legitimately arrive while the
// snapshot request is still in flight — it must not be lost.
describe("createHerdrState snapshot-in-flight buffering", () => {
  // Without this, a pane created while the snapshot round-trip is in flight
  // would vanish from the store until the next reconnect happens to include it.
  test("a pane_created delivered before the snapshot response arrives is included once it lands", async () => {
    const gw = createFakeHerdr(snapshot);
    const { gateway, release } = withDelayedSnapshot(gw);
    const store = createHerdrState(gateway);

    gw.emit({
      event: "pane_created",
      data: {
        type: "pane_created",
        pane: {
          pane_id: "live-pane",
          terminal_id: "live-term",
          workspace_id: snapshot.workspaces[0]!.workspace_id,
          tab_id: snapshot.tabs[0]!.tab_id,
          focused: false,
          agent_status: "unknown",
          revision: 0,
        },
      },
    });

    release();
    await settle();

    expect(store.get().panes.has("live-pane")).toBe(true);
    expect(store.get().panes.size).toBe(snapshot.panes.length + 1);
  });

  // Without this, the sidebar would stop reflecting live changes once the
  // initial snapshot has loaded.
  test("a pane_created delivered after the snapshot has loaded is applied immediately", async () => {
    const gw = createFakeHerdr(snapshot);
    const store = createHerdrState(gw);
    await settle();
    expect(store.get().panes.size).toBe(snapshot.panes.length);

    const created = await gw.workspaceCreate({ cwd: "/tmp/live", label: "live-ws" });

    expect(store.get().workspaces.has(created.workspace_id)).toBe(true);
  });
});
