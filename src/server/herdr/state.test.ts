import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import {
  applyEvent,
  describeChange,
  effectiveCwd,
  emptyState,
  stateFromSnapshot,
  type HerdrState,
  type PaneWorktreeOverride,
  type PaneWorktreeOverrideRepository,
} from "./state";
import { createFakeHerdr, type FakeHerdr } from "./fake";
import { createHerdrState } from "./state";
import type { HerdrGateway } from "./gateway";
import type { SessionSnapshot } from "../../contract/herdr";

function inMemoryOverrideRepo(): PaneWorktreeOverrideRepository & {
  rows: Map<string, PaneWorktreeOverride>;
} {
  const rows = new Map<string, PaneWorktreeOverride>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async set(override) {
      rows.set(override.paneId, override);
    },
    async delete(paneId) {
      rows.delete(paneId);
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

  test("pane_updated drops the pane's worktree override once its raw cwd no longer matches what was observed when the override was set", () => {
    const base = stateFromSnapshot(snapshot);
    const pane = snapshot.panes[0]!;
    const observedCwd = pane.foreground_cwd ?? pane.cwd ?? null;
    const withOverride: HerdrState = {
      ...base,
      paneWorktreeOverrides: new Map([
        [pane.pane_id, { paneId: pane.pane_id, root: "/declared/wt", observedCwd, setAt: "t0" }],
      ]),
    };

    // 無いと壊れる: エージェント本体が本当に別の worktree へ移動したのに、
    // 古い宣言がいつまでも effectiveCwd を上書きし続けてしまう。
    const moved = applyEvent(withOverride, {
      event: "pane_updated",
      data: { type: "pane_updated", pane: { ...pane, foreground_cwd: "/somewhere/else" } },
    });
    expect(moved.paneWorktreeOverrides.has(pane.pane_id)).toBe(false);

    // 無いと壊れる: cwd が変わっていないだけの通常更新（例えば agent_status の
    // 反映）まで宣言を消してしまうと、宣言のたびに hw worktree use を打ち直す
    // 羽目になる。
    const unrelatedUpdate = applyEvent(withOverride, {
      event: "pane_updated",
      data: { type: "pane_updated", pane: { ...pane, agent_status: "blocked" } },
    });
    expect(unrelatedUpdate.paneWorktreeOverrides.get(pane.pane_id)?.root).toBe("/declared/wt");
  });

  test("pane_closed drops the pane's worktree override", () => {
    const base = stateFromSnapshot(snapshot);
    const pane = snapshot.panes[0]!;
    const withOverride: HerdrState = {
      ...base,
      paneWorktreeOverrides: new Map([
        [
          pane.pane_id,
          {
            paneId: pane.pane_id,
            root: "/declared/wt",
            observedCwd: pane.foreground_cwd ?? pane.cwd ?? null,
            setAt: "t0",
          },
        ],
      ]),
    };
    // 無いと壊れる: pane が閉じた後も宣言が残ると、同じ pane_id が別の agent に
    // 再利用された（あるいは表示上ゴーストとして残った）ときに誤った worktree
    // へ勝手に紐付いてしまう。
    const next = applyEvent(withOverride, {
      event: "pane_closed",
      data: { type: "pane_closed", pane_id: pane.pane_id, workspace_id: pane.workspace_id },
    });
    expect(next.paneWorktreeOverrides.has(pane.pane_id)).toBe(false);
  });
});

describe("effectiveCwd", () => {
  test.each([
    [
      "an override root wins over foreground_cwd/cwd",
      "/declared/wt",
      "/fg",
      "/cwd",
      "/declared/wt",
    ],
    ["falls back to foreground_cwd when there's no override", null, "/fg", "/cwd", "/fg"],
    [
      "falls back to cwd when foreground_cwd is null and there's no override",
      null,
      null,
      "/cwd",
      "/cwd",
    ],
  ])("%s", (_label, overrideRoot, foregroundCwd, cwd, expected) => {
    const paneWorktreeOverrides = overrideRoot
      ? new Map([
          ["p1", { paneId: "p1", root: overrideRoot, observedCwd: foregroundCwd, setAt: "t" }],
        ])
      : new Map();
    expect(
      effectiveCwd(
        { paneWorktreeOverrides },
        { pane_id: "p1", foreground_cwd: foregroundCwd, cwd },
      ),
    ).toBe(expected);
  });

  test("returns null for a null/undefined pane", () => {
    expect(effectiveCwd({ paneWorktreeOverrides: new Map() }, null)).toBeNull();
    expect(effectiveCwd({ paneWorktreeOverrides: new Map() }, undefined)).toBeNull();
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

describe("createHerdrState: pane worktree overrides", () => {
  test("setWorktreeOverride makes effectiveCwd report the declared root; clearWorktreeOverride removes it", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemoryOverrideRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();
    const paneId = snapshot.panes[0]!.pane_id;

    expect(store.setWorktreeOverride(paneId, "/declared/wt")).toEqual({ ok: true });
    expect(effectiveCwd(store.get(), store.get().panes.get(paneId))).toBe("/declared/wt");

    store.clearWorktreeOverride(paneId);
    const pane = store.get().panes.get(paneId)!;
    expect(effectiveCwd(store.get(), pane)).toBe(pane.foreground_cwd ?? pane.cwd ?? null);
  });

  // 無いと壊れる: 存在しない pane 宛の宣言が黙って受理され、DB に孤児レコードが残る。
  test("setWorktreeOverride on an unknown pane returns pane_not_found and persists nothing", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemoryOverrideRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();

    expect(store.setWorktreeOverride("no-such-pane", "/declared/wt")).toEqual({
      ok: false,
      reason: "pane_not_found",
    });
    expect(repo.rows.size).toBe(0);
  });

  // 無いと壊れる: pane が閉じても DB 上の宣言が残り続け、bun --watch 再起動のたびに
  // 別の agent がその pane_id を再利用したときに誤った worktree へ紐付いてしまう。
  test("closing a pane deletes its persisted override", async () => {
    const gw = createFakeHerdr(snapshot);
    const repo = inMemoryOverrideRepo();
    const store = createHerdrState(gw, undefined, repo);
    await settle();
    const paneId = snapshot.panes[0]!.pane_id;
    store.setWorktreeOverride(paneId, "/declared/wt");
    await settle();
    expect(repo.rows.has(paneId)).toBe(true);

    gw.closePane(paneId);
    await settle();
    expect(repo.rows.has(paneId)).toBe(false);
  });

  // 無いと壊れる: これが無いと bun --watch の再起動（または herdr 再接続）のたびに
  // 宣言を失い、長いセッション中に何度も hw worktree use を打ち直す羽目になる。
  test("survives a fresh store over the same repository, as long as the pane's cwd hasn't drifted", async () => {
    const repo = inMemoryOverrideRepo();
    const paneId = snapshot.panes[0]!.pane_id;
    const first = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();
    first.setWorktreeOverride(paneId, "/declared/wt");
    await settle();

    const second = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();
    const pane = second.get().panes.get(paneId)!;
    expect(effectiveCwd(second.get(), pane)).toBe("/declared/wt");
  });

  // 無いと壊れる: ストアが無かった間（再起動中）に本体が実際に別 worktree へ
  // 移動したケースを見逃し、古い宣言をいつまでも effectiveCwd が返し続ける。
  test("does not restore an override whose pane's cwd drifted while no store held it", async () => {
    const repo = inMemoryOverrideRepo();
    const paneId = snapshot.panes[0]!.pane_id;
    const first = createHerdrState(createFakeHerdr(snapshot), undefined, repo);
    await settle();
    first.setWorktreeOverride(paneId, "/declared/wt");
    await settle();

    const driftedSnapshot: SessionSnapshot = {
      ...snapshot,
      panes: snapshot.panes.map((p) =>
        p.pane_id === paneId ? { ...p, foreground_cwd: "/moved/elsewhere" } : p,
      ),
    };
    const second = createHerdrState(createFakeHerdr(driftedSnapshot), undefined, repo);
    await settle();
    const pane = second.get().panes.get(paneId)!;
    expect(effectiveCwd(second.get(), pane)).toBe("/moved/elsewhere");
    expect(repo.rows.has(paneId)).toBe(false);
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
