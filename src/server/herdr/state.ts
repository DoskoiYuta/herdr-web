import { match } from "ts-pattern";
import type {
  HerdrEventData,
  HerdrEventEnvelope,
  PaneInfo,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
} from "../../contract/herdr";
import type { HerdrGateway } from "./gateway";

export interface HerdrState {
  panes: Map<string, PaneInfo>;
  workspaces: Map<string, WorkspaceInfo>;
  tabs: Map<string, TabInfo>;
  focusedPaneId: string | null;
  focusedWorkspaceId: string | null;
  focusedTabId: string | null;
  paneWorktreeOverrides: Map<string, PaneWorktreeOverride>;
}

/** An agent-declared worktree for a pane (`hw worktree use`), overriding herdr's `foreground_cwd`. */
export type PaneWorktreeOverride = {
  paneId: string;
  root: string;
  /** The pane's `foreground_cwd ?? cwd` observed when the override was set — used to detect drift (see `withPane`). */
  observedCwd: string | null;
  setAt: string;
};

export type StateChange =
  | { kind: "reset" }
  | { kind: "pane"; paneId: string }
  | { kind: "pane-removed"; paneId: string }
  | { kind: "focus" }
  /** tree にもフォーカスにも影響しない変化（layout 等）。herdr は毎秒何度も送るので消費側は無視する。 */
  | { kind: "none" };

export function emptyState(): HerdrState {
  return {
    panes: new Map(),
    workspaces: new Map(),
    tabs: new Map(),
    focusedPaneId: null,
    focusedWorkspaceId: null,
    focusedTabId: null,
    paneWorktreeOverrides: new Map(),
  };
}

export function stateFromSnapshot(snapshot: SessionSnapshot): HerdrState {
  return {
    panes: new Map(snapshot.panes.map((p) => [p.pane_id, p])),
    workspaces: new Map(snapshot.workspaces.map((w) => [w.workspace_id, w])),
    tabs: new Map(snapshot.tabs.map((t) => [t.tab_id, t])),
    focusedPaneId: snapshot.focused_pane_id ?? null,
    focusedWorkspaceId: snapshot.focused_workspace_id ?? null,
    focusedTabId: snapshot.focused_tab_id ?? null,
    paneWorktreeOverrides: new Map(),
  };
}

/**
 * The single choke point every reader of a pane's worktree must use instead of
 * `pane.foreground_cwd ?? pane.cwd` directly. `foreground_cwd` tracks the tty's
 * foreground process — the agent binary itself — so it never reflects a
 * worktree a subprocess (or a worktree-isolated subagent) actually moved into;
 * an explicit `hw worktree use` override (§ setWorktreeOverride) takes
 * precedence over it for exactly that reason.
 */
export function effectiveCwd(
  state: Pick<HerdrState, "paneWorktreeOverrides">,
  pane: { pane_id: string; foreground_cwd?: string | null; cwd?: string | null } | null | undefined,
): string | null {
  if (!pane) return null;
  const override = state.paneWorktreeOverrides.get(pane.pane_id);
  if (override) return override.root;
  return pane.foreground_cwd ?? pane.cwd ?? null;
}

/** Drops `pane`'s override once its raw cwd no longer matches what was observed when it was set (auto-clear condition 2). */
function dropDivergedOverride(state: HerdrState, pane: PaneInfo): HerdrState {
  const override = state.paneWorktreeOverrides.get(pane.pane_id);
  if (!override) return state;
  const rawCwd = pane.foreground_cwd ?? pane.cwd ?? null;
  if (rawCwd === override.observedCwd) return state;
  const paneWorktreeOverrides = new Map(state.paneWorktreeOverrides);
  paneWorktreeOverrides.delete(pane.pane_id);
  return { ...state, paneWorktreeOverrides };
}

function withPane(state: HerdrState, pane: PaneInfo): HerdrState {
  const panes = new Map(state.panes);
  panes.set(pane.pane_id, pane);
  return dropDivergedOverride({ ...state, panes }, pane);
}

/** Drops overrides for panes no longer present in `panes` (auto-clear condition 1: pane closed). */
function dropOverridesForRemovedPanes(
  overrides: Map<string, PaneWorktreeOverride>,
  panes: Map<string, PaneInfo>,
): Map<string, PaneWorktreeOverride> {
  const filtered = new Map([...overrides].filter(([paneId]) => panes.has(paneId)));
  return filtered.size === overrides.size ? overrides : filtered;
}

/**
 * herdr's pane.updated / pane.moved payloads omit `agent_session` and carry
 * `agent_status: "unknown"` even while `pane.get` reports a live status and
 * session (herdr 0.8.2). For the same agent, keep what the store already knows;
 * agent changes themselves arrive via pane.agent_detected.
 */
function mergePaneUpdate(state: HerdrState, pane: PaneInfo): HerdrState {
  const existing = state.panes.get(pane.pane_id);
  // A closed pane can still have an update/move event in flight (herdr's
  // ordering isn't guaranteed under close): without this guard the update
  // resurrects it as a pane the store otherwise has no way to know is gone.
  if (!existing) return state;
  if (existing.agent !== pane.agent || pane.agent == null) return withPane(state, pane);
  return withPane(state, {
    ...pane,
    agent_session: pane.agent_session ?? existing.agent_session,
    agent_status: pane.agent_status === "unknown" ? existing.agent_status : pane.agent_status,
  });
}

function withoutPane(state: HerdrState, paneId: string): HerdrState {
  const panes = new Map(state.panes);
  panes.delete(paneId);
  return {
    ...state,
    panes,
    paneWorktreeOverrides: dropOverridesForRemovedPanes(state.paneWorktreeOverrides, panes),
    focusedPaneId: state.focusedPaneId === paneId ? null : state.focusedPaneId,
  };
}

function withWorkspace(state: HerdrState, workspace: WorkspaceInfo): HerdrState {
  const workspaces = new Map(state.workspaces);
  workspaces.set(workspace.workspace_id, workspace);
  return { ...state, workspaces };
}

/** For update-only events (never creation): a late update for a workspace
 * already closed must not resurrect it. */
function updateWorkspace(state: HerdrState, workspace: WorkspaceInfo): HerdrState {
  if (!state.workspaces.has(workspace.workspace_id)) return state;
  return withWorkspace(state, workspace);
}

function withWorkspaces(state: HerdrState, list: readonly WorkspaceInfo[]): HerdrState {
  const workspaces = new Map(state.workspaces);
  for (const w of list) workspaces.set(w.workspace_id, w);
  return { ...state, workspaces };
}

/** herdr は workspace を閉じても配下の tab/pane の closed イベントを出さないので、ここでまとめて落とす。 */
function withoutWorkspace(state: HerdrState, workspaceId: string): HerdrState {
  const workspaces = new Map(state.workspaces);
  workspaces.delete(workspaceId);
  const tabs = new Map([...state.tabs].filter(([, t]) => t.workspace_id !== workspaceId));
  const panes = new Map([...state.panes].filter(([, p]) => p.workspace_id !== workspaceId));
  return {
    ...state,
    workspaces,
    tabs,
    panes,
    paneWorktreeOverrides: dropOverridesForRemovedPanes(state.paneWorktreeOverrides, panes),
    focusedWorkspaceId: state.focusedWorkspaceId === workspaceId ? null : state.focusedWorkspaceId,
    focusedPaneId:
      state.focusedPaneId && !panes.has(state.focusedPaneId) ? null : state.focusedPaneId,
  };
}

function renameWorkspace(state: HerdrState, workspaceId: string, label: string): HerdrState {
  const existing = state.workspaces.get(workspaceId);
  if (!existing) return state;
  return withWorkspace(state, { ...existing, label });
}

function withTab(state: HerdrState, tab: TabInfo): HerdrState {
  const tabs = new Map(state.tabs);
  tabs.set(tab.tab_id, tab);
  return { ...state, tabs };
}

function withTabs(state: HerdrState, list: readonly TabInfo[]): HerdrState {
  const tabs = new Map(state.tabs);
  for (const t of list) tabs.set(t.tab_id, t);
  return { ...state, tabs };
}

/** tab を閉じたときも配下の pane を落とす（pane_closed が来ないケースに備える）。 */
function withoutTab(state: HerdrState, tabId: string): HerdrState {
  const tabs = new Map(state.tabs);
  tabs.delete(tabId);
  const panes = new Map([...state.panes].filter(([, p]) => p.tab_id !== tabId));
  return {
    ...state,
    tabs,
    panes,
    paneWorktreeOverrides: dropOverridesForRemovedPanes(state.paneWorktreeOverrides, panes),
    focusedPaneId:
      state.focusedPaneId && !panes.has(state.focusedPaneId) ? null : state.focusedPaneId,
  };
}

function renameTab(state: HerdrState, tabId: string, label: string): HerdrState {
  const existing = state.tabs.get(tabId);
  if (!existing) return state;
  return withTab(state, { ...existing, label });
}

function applyPaneAgentDetected(
  state: HerdrState,
  event: Extract<HerdrEventData, { type: "pane_agent_detected" }>,
): HerdrState {
  const existing = state.panes.get(event.pane_id);
  if (!existing) return state;
  const next: PaneInfo = { ...existing, agent: event.agent ?? null };
  if (event.final_status) next.agent_status = event.final_status;
  if (event.released || event.agent === null) {
    next.agent = null;
    next.agent_session = null;
  }
  return withPane(state, next);
}

function applyPaneAgentStatusChanged(
  state: HerdrState,
  event: Extract<HerdrEventData, { type: "pane_agent_status_changed" }>,
): HerdrState {
  const existing = state.panes.get(event.pane_id);
  if (!existing) return state;
  const next: PaneInfo = { ...existing, agent_status: event.agent_status };
  if (event.agent !== undefined) {
    next.agent = event.agent;
    if (event.agent === null) next.agent_session = null;
  }
  return withPane(state, next);
}

/** Pure reducer over the herdr event union (ts-pattern `.exhaustive()` — new EventKinds fail to compile). */
export function applyEvent(state: HerdrState, envelope: HerdrEventEnvelope): HerdrState {
  const data: HerdrEventData = envelope.data;
  return (
    match(data)
      // Live creation order for a new workspace is pane -> workspace -> tab,
      // so a pane/tab_created legitimately arrives before its workspace
      // exists in this store — don't guard pane_created/tab_created on
      // workspace existence.
      .with({ type: "pane_created" }, (d) => withPane(state, d.pane))
      .with({ type: "pane_updated" }, (d) => mergePaneUpdate(state, d.pane))
      .with({ type: "pane_moved" }, (d) => mergePaneUpdate(state, d.pane))
      .with({ type: "pane_closed" }, (d) => withoutPane(state, d.pane_id))
      .with({ type: "pane_exited" }, (d) => withoutPane(state, d.pane_id))
      .with({ type: "pane_focused" }, (d) =>
        state.panes.has(d.pane_id)
          ? { ...state, focusedPaneId: d.pane_id, focusedWorkspaceId: d.workspace_id }
          : state,
      )
      .with({ type: "pane_agent_detected" }, (d) => applyPaneAgentDetected(state, d))
      .with({ type: "pane_agent_status_changed" }, (d) => applyPaneAgentStatusChanged(state, d))
      .with({ type: "workspace_created" }, (d) => withWorkspace(state, d.workspace))
      .with({ type: "workspace_updated" }, (d) => updateWorkspace(state, d.workspace))
      .with({ type: "workspace_metadata_updated" }, (d) => updateWorkspace(state, d.workspace))
      .with({ type: "workspace_closed" }, (d) => withoutWorkspace(state, d.workspace_id))
      .with({ type: "workspace_renamed" }, (d) => renameWorkspace(state, d.workspace_id, d.label))
      .with({ type: "workspace_moved" }, (d) => withWorkspaces(state, d.workspaces))
      .with({ type: "workspace_reordered" }, (d) => withWorkspaces(state, d.workspaces))
      .with({ type: "workspace_focused" }, (d) =>
        state.workspaces.has(d.workspace_id)
          ? { ...state, focusedWorkspaceId: d.workspace_id }
          : state,
      )
      .with({ type: "worktree_created" }, () => state)
      .with({ type: "worktree_opened" }, () => state)
      .with({ type: "worktree_removed" }, () => state)
      .with({ type: "tab_created" }, (d) => withTab(state, d.tab))
      .with({ type: "tab_closed" }, (d) => withoutTab(state, d.tab_id))
      .with({ type: "tab_renamed" }, (d) => renameTab(state, d.tab_id, d.label))
      .with({ type: "tab_moved" }, (d) => withTabs(state, d.tabs))
      .with({ type: "tab_focused" }, (d) =>
        state.tabs.has(d.tab_id) ? { ...state, focusedTabId: d.tab_id } : state,
      )
      .with({ type: "layout_updated" }, () => state)
      .exhaustive()
  );
}

/** What downstream (tree/focus/hub) needs to know changed, without diffing full state. */
export function describeChange(envelope: HerdrEventEnvelope): StateChange {
  const data: HerdrEventData = envelope.data;
  return match(data)
    .with({ type: "pane_created" }, (d) => ({ kind: "pane" as const, paneId: d.pane.pane_id }))
    .with({ type: "pane_updated" }, (d) => ({ kind: "pane" as const, paneId: d.pane.pane_id }))
    .with({ type: "pane_moved" }, (d) => ({ kind: "pane" as const, paneId: d.pane.pane_id }))
    .with({ type: "pane_closed" }, (d) => ({ kind: "pane-removed" as const, paneId: d.pane_id }))
    .with({ type: "pane_exited" }, (d) => ({ kind: "pane-removed" as const, paneId: d.pane_id }))
    .with({ type: "pane_focused" }, () => ({ kind: "focus" as const }))
    .with({ type: "workspace_focused" }, () => ({ kind: "focus" as const }))
    .with({ type: "tab_focused" }, () => ({ kind: "focus" as const }))
    .with({ type: "pane_agent_detected" }, () => ({ kind: "reset" as const }))
    .with({ type: "pane_agent_status_changed" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_created" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_updated" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_metadata_updated" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_closed" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_renamed" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_moved" }, () => ({ kind: "reset" as const }))
    .with({ type: "workspace_reordered" }, () => ({ kind: "reset" as const }))
    .with({ type: "worktree_created" }, () => ({ kind: "reset" as const }))
    .with({ type: "worktree_opened" }, () => ({ kind: "reset" as const }))
    .with({ type: "worktree_removed" }, () => ({ kind: "reset" as const }))
    .with({ type: "tab_created" }, () => ({ kind: "reset" as const }))
    .with({ type: "tab_closed" }, () => ({ kind: "reset" as const }))
    .with({ type: "tab_renamed" }, () => ({ kind: "reset" as const }))
    .with({ type: "tab_moved" }, () => ({ kind: "reset" as const }))
    .with({ type: "layout_updated" }, () => ({ kind: "none" as const }))
    .exhaustive();
}

export interface HerdrStateStore {
  get(): HerdrState;
  onChange(cb: (change: StateChange) => void): () => void;
  /**
   * Merge fresh pane data into the store outside the normal event stream —
   * used by the focus poller (§12-1) when it detects a `foreground_cwd`
   * drift that herdr never announced via `pane_updated`. Notifies the same
   * way a `pane_updated` event would, so other subscribers (tree, notifier)
   * stay in sync too.
   */
  patchPane(pane: PaneInfo): void;
  /**
   * True once `session.snapshot` has been loaded — i.e. `panes` can be
   * trusted. False before the first snapshot arrives (including while one is
   * in flight) and again right after a disconnect (F13-9 decision delivery
   * relies on this to avoid misreading a pane as gone).
   */
  isSettled(): boolean;
  /** `hw worktree use`: declares `root` as pane's worktree, overriding `effectiveCwd`. */
  setWorktreeOverride(
    paneId: string,
    root: string,
  ): { ok: true } | { ok: false; reason: "pane_not_found" };
  /** `hw worktree clear`: removes any override for the pane (no-op if none). */
  clearWorktreeOverride(paneId: string): void;
}

/** Persistence port for `HerdrState.paneWorktreeOverrides` (`src/server/herdr/worktree-overrides.ts` has the SQLite implementation). */
export interface PaneWorktreeOverrideRepository {
  list(): Promise<PaneWorktreeOverride[]>;
  set(override: PaneWorktreeOverride): Promise<void>;
  delete(paneId: string): Promise<void>;
}

function createInMemoryOverrideRepository(): PaneWorktreeOverrideRepository {
  return {
    async list() {
      return [];
    },
    async set() {},
    async delete() {},
  };
}

export type Logger = Pick<typeof console, "error" | "warn">;

/**
 * Loads the snapshot on connect, applies events as they arrive, and re-snapshots
 * whenever the gateway (re)connects — including the very first connection, so
 * callers don't need to special-case startup (plan.md deliverable 4).
 *
 * The gateway subscribes before requesting the snapshot (socket-client.ts), so
 * a live event can arrive while the `session.snapshot` request is still in
 * flight. Such events are buffered and folded into the state, in arrival
 * order, once the snapshot response lands — the reducer is an upsert (or a
 * no-op for an id the snapshot doesn't know), so replaying them after the
 * snapshot is harmless even though the snapshot already reflects some of them.
 */
export function createHerdrState(
  gateway: HerdrGateway,
  logger: Logger = console,
  overrides: PaneWorktreeOverrideRepository = createInMemoryOverrideRepository(),
): HerdrStateStore {
  let state = emptyState();
  let hasSnapshot = false;
  let snapshotInFlight = false;
  let pendingEvents: HerdrEventEnvelope[] = [];
  // Guards against a snapshot request that outlives the connection it was
  // issued for (e.g. herdr drops right after we asked for session.snapshot):
  // a stale response arriving after a disconnect must not resurrect state.
  let snapshotGeneration = 0;
  const listeners = new Set<(change: StateChange) => void>();

  function notify(change: StateChange): void {
    for (const cb of listeners) {
      try {
        cb(change);
      } catch (err) {
        logger.error("herdr state listener threw", err);
      }
    }
  }

  /** Persists any override the pure reducer already dropped (§ dropDivergedOverride / dropOverridesForRemovedPanes). */
  function persistOverrideRemovals(prev: HerdrState, next: HerdrState): void {
    if (prev.paneWorktreeOverrides === next.paneWorktreeOverrides) return;
    for (const paneId of prev.paneWorktreeOverrides.keys()) {
      if (next.paneWorktreeOverrides.has(paneId)) continue;
      void overrides.delete(paneId).catch((err) => {
        logger.error(`herdr: failed to delete pane worktree override for ${paneId}`, err);
      });
    }
  }

  // Agent lifecycle events carry only a few fields (no agent_session, and the
  // status is sometimes a step behind pane.get), so re-read the pane to converge.
  async function refreshPane(paneId: string): Promise<void> {
    try {
      const fresh = await gateway.paneGet(paneId);
      if (!state.panes.has(paneId)) return;
      const prev = state;
      state = withPane(state, fresh);
      persistOverrideRemovals(prev, state);
      notify({ kind: "pane", paneId });
    } catch (err) {
      logger.warn(`herdr: pane.get after agent event failed for ${paneId}`, err);
    }
  }

  function applyIncoming(event: HerdrEventEnvelope): void {
    const prev = state;
    state = applyEvent(state, event);
    persistOverrideRemovals(prev, state);
    const data = event.data;
    if (data.type === "pane_agent_detected" || data.type === "pane_agent_status_changed") {
      void refreshPane(data.pane_id);
    }
  }

  /**
   * Re-applies persisted overrides onto a freshly loaded snapshot, dropping (and
   * persisting the drop of) any whose pane closed or whose cwd drifted while we
   * had no snapshot to check against (auto-clear conditions 1/2, deferred).
   */
  async function reconcileOverridesWithSnapshot(): Promise<void> {
    let stored: PaneWorktreeOverride[];
    try {
      stored = await overrides.list();
    } catch (err) {
      logger.error("herdr: failed to load pane worktree overrides", err);
      return;
    }
    if (stored.length === 0) return;
    const next = new Map(state.paneWorktreeOverrides);
    for (const override of stored) {
      const pane = state.panes.get(override.paneId);
      const rawCwd = pane ? (pane.foreground_cwd ?? pane.cwd ?? null) : null;
      if (!pane || rawCwd !== override.observedCwd) {
        void overrides.delete(override.paneId).catch((err) => {
          logger.error(
            `herdr: failed to delete pane worktree override for ${override.paneId}`,
            err,
          );
        });
        continue;
      }
      next.set(override.paneId, override);
    }
    state = { ...state, paneWorktreeOverrides: next };
  }

  async function loadSnapshot(): Promise<void> {
    const generation = ++snapshotGeneration;
    snapshotInFlight = true;
    try {
      const snapshot = await gateway.snapshot();
      if (generation !== snapshotGeneration) return; // superseded by a disconnect since this call started
      state = stateFromSnapshot(snapshot);
      await reconcileOverridesWithSnapshot();
      if (generation !== snapshotGeneration) return;
      hasSnapshot = true;
      snapshotInFlight = false;
      const buffered = pendingEvents;
      pendingEvents = [];
      for (const event of buffered) {
        try {
          applyIncoming(event);
        } catch (err) {
          logger.error("herdr: failed to apply event", err, event);
        }
      }
      notify({ kind: "reset" });
    } catch (err) {
      if (generation !== snapshotGeneration) return;
      logger.error("herdr: failed to load session.snapshot", err);
      // Drop whatever buffered during the failed request rather than retry
      // with stale data — the next reconnect issues a fresh snapshot request.
      pendingEvents = [];
      snapshotInFlight = false;
    }
  }

  gateway.subscribe((event) => {
    if (snapshotInFlight) {
      pendingEvents.push(event);
      return;
    }
    try {
      applyIncoming(event);
      notify(describeChange(event));
    } catch (err) {
      logger.error("herdr: failed to apply event", err, event);
    }
  });

  let wasConnected = gateway.status().connected;
  gateway.onStatus((status) => {
    if (status.connected && !wasConnected) void loadSnapshot();
    if (!status.connected && wasConnected) {
      // herdr disconnected: drop the stale snapshot so the notifier (and anything
      // else reading the store) can never target a pane that may no longer exist —
      // "ghost panes" would otherwise linger until the next reconnect's snapshot.
      snapshotGeneration++;
      pendingEvents = [];
      snapshotInFlight = false;
      state = emptyState();
      hasSnapshot = false;
      notify({ kind: "reset" });
    }
    wasConnected = status.connected;
  });
  if (gateway.status().connected) void loadSnapshot();

  return {
    get: () => state,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    patchPane: (pane) => {
      const prev = state;
      state = withPane(state, pane);
      persistOverrideRemovals(prev, state);
      notify({ kind: "pane", paneId: pane.pane_id });
    },
    isSettled: () => hasSnapshot,
    setWorktreeOverride(paneId, root) {
      const pane = state.panes.get(paneId);
      if (!pane) return { ok: false, reason: "pane_not_found" };
      const override: PaneWorktreeOverride = {
        paneId,
        root,
        observedCwd: pane.foreground_cwd ?? pane.cwd ?? null,
        setAt: new Date().toISOString(),
      };
      const paneWorktreeOverrides = new Map(state.paneWorktreeOverrides);
      paneWorktreeOverrides.set(paneId, override);
      state = { ...state, paneWorktreeOverrides };
      void overrides.set(override).catch((err) => {
        logger.error(`herdr: failed to save pane worktree override for ${paneId}`, err);
      });
      notify({ kind: "pane", paneId });
      return { ok: true };
    },
    clearWorktreeOverride(paneId) {
      if (!state.paneWorktreeOverrides.has(paneId)) return;
      const paneWorktreeOverrides = new Map(state.paneWorktreeOverrides);
      paneWorktreeOverrides.delete(paneId);
      state = { ...state, paneWorktreeOverrides };
      void overrides.delete(paneId).catch((err) => {
        logger.error(`herdr: failed to delete pane worktree override for ${paneId}`, err);
      });
      notify({ kind: "pane", paneId });
    },
  };
}
