import type {
  HerdrEventEnvelope,
  PaneInfo,
  PaneLayoutSnapshot,
  PingResult,
  SessionSnapshot,
  WorkspaceInfo,
} from "../../contract/herdr";
import type { AgentPromptOutcome, HerdrGateway, HerdrStatus } from "./gateway";

/**
 * In-memory `HerdrGateway` test double (plan.md deliverable 3). Backs the
 * reducer/tree/focus/hub tests and, later, the review notifier tests.
 */
export interface FakeHerdr extends HerdrGateway {
  /** Broadcast an event to every subscriber, as herdr would over the events.subscribe connection. */
  emit(event: HerdrEventEnvelope): void;
  /** Focus a pane: flips `focused` on all panes, focuses its workspace/tab too, and emits the matching events. */
  focusPane(paneId: string): void;
  /** Change a pane's foreground_cwd and emit `pane_updated`. */
  setForegroundCwd(paneId: string, cwd: string | null): void;
  /** Remove a pane and emit `pane_closed`. */
  closePane(paneId: string): void;
  /** Make the next `agentPrompt` targeting this pane resolve with `agent_blocked` instead of sending. */
  simulateAgentBlocked(paneId: string, blocked?: boolean): void;
  /** Make the next `agentStart` targeting this pane reject, simulating a herdr RPC failure. */
  failAgentStart(paneId: string, fail?: boolean): void;
  setStatus(status: HerdrStatus): void;
  /** Directly mutate a pane record and emit `pane_updated` (for arbitrary field changes in tests). */
  updatePane(paneId: string, patch: Partial<PaneInfo>): void;
  /**
   * Mutate a pane's foreground_cwd WITHOUT emitting any event — simulates herdr
   * changing `foreground_cwd` silently, so `gateway.paneGet` polling is the only
   * way to observe it (plan.md §12-1 fallback).
   */
  setForegroundCwdSilently(paneId: string, cwd: string | null): void;
  /** Mutate any pane fields WITHOUT emitting an event — only `paneGet` reveals them. */
  setPaneSilently(paneId: string, patch: Partial<PaneInfo>): void;
  /** Configure what `paneLayout(paneId)` resolves with. */
  setPaneLayout(paneId: string, layout: PaneLayoutSnapshot): void;
  /** Make the next `paneLayout(paneId)` calls reject, simulating a herdr RPC failure. */
  failPaneLayout(paneId: string, fail?: boolean): void;
  /** Configure what `paneRead(paneId, lines)` resolves with. */
  setPaneReadText(paneId: string, text: string): void;
  /** Make the next `paneRead(paneId, lines)` calls reject, simulating a herdr RPC failure. */
  failPaneRead(paneId: string, fail?: boolean): void;
  /** Every `notificationShow` call so far, in order. */
  notificationsShown: { title: string; body?: string | null; sound?: string }[];
  /** Make the next `notificationShow` call reject, simulating a herdr RPC failure. */
  failNotificationShow(fail?: boolean): void;
}

export function createFakeHerdr(initial: SessionSnapshot): FakeHerdr {
  const panes = new Map(initial.panes.map((p) => [p.pane_id, p]));
  const workspaces = new Map(initial.workspaces.map((w) => [w.workspace_id, w]));
  const tabs = new Map(initial.tabs.map((t) => [t.tab_id, t]));
  let focusedPaneId = initial.focused_pane_id ?? null;
  let focusedWorkspaceId = initial.focused_workspace_id ?? null;
  let focusedTabId = initial.focused_tab_id ?? null;
  let status: HerdrStatus = { connected: true, protocol: 20 };
  const blockedPanes = new Set<string>();
  const paneLayouts = new Map<string, PaneLayoutSnapshot>();
  const failingLayoutPanes = new Set<string>();
  const paneReadTexts = new Map<string, string>();
  const failingReadPanes = new Set<string>();
  const failingAgentStartPanes = new Set<string>();
  let nextWorkspaceNumber = workspaces.size + 1;
  const notificationsShown: { title: string; body?: string | null; sound?: string }[] = [];
  let failNextNotificationShow = false;

  const subscribers = new Set<(event: HerdrEventEnvelope) => void>();
  const statusListeners = new Set<(status: HerdrStatus) => void>();

  function requirePane(paneId: string): PaneInfo {
    const pane = panes.get(paneId);
    if (!pane) throw new Error(`fake herdr: unknown pane ${paneId}`);
    return pane;
  }

  function emit(event: HerdrEventEnvelope): void {
    for (const handler of subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error("fake herdr: subscriber threw", err);
      }
    }
  }

  return {
    async ping(): Promise<PingResult> {
      return { type: "pong", version: "0.8.2-fake", protocol: status.protocol ?? 20 };
    },
    async snapshot(): Promise<SessionSnapshot> {
      return {
        version: "0.8.2-fake",
        protocol: status.protocol ?? 20,
        workspaces: [...workspaces.values()],
        tabs: [...tabs.values()],
        panes: [...panes.values()],
        agents: [...panes.values()],
        focused_pane_id: focusedPaneId,
        focused_tab_id: focusedTabId,
        focused_workspace_id: focusedWorkspaceId,
      };
    },
    async paneGet(paneId: string): Promise<PaneInfo> {
      return requirePane(paneId);
    },
    async paneFocus(paneId: string): Promise<PaneInfo> {
      const pane = requirePane(paneId);
      this.focusPane(paneId);
      return { ...pane, focused: true };
    },
    async workspaceFocus(workspaceId: string): Promise<void> {
      if (!workspaces.has(workspaceId))
        throw new Error(`fake herdr: unknown workspace ${workspaceId}`);
      focusedWorkspaceId = workspaceId;
      emit({
        event: "workspace_focused",
        data: { type: "workspace_focused", workspace_id: workspaceId },
      });
    },
    async workspaceCreate(params: {
      cwd: string | null;
      label?: string | null;
      focus?: boolean;
      env?: Record<string, string>;
    }): Promise<WorkspaceInfo> {
      const number = nextWorkspaceNumber++;
      const workspaceId = `fw${number}`;
      const tabId = `${workspaceId}:t1`;
      const paneId = `${workspaceId}:p1`;
      const workspace: WorkspaceInfo = {
        workspace_id: workspaceId,
        number,
        label: params.label ?? `${number}`,
        focused: params.focus ?? false,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: tabId,
        agent_status: "unknown",
      };
      const tab = {
        tab_id: tabId,
        workspace_id: workspaceId,
        number: 1,
        label: "1",
        focused: params.focus ?? false,
        pane_count: 1,
        agent_status: "unknown" as const,
      };
      const pane: PaneInfo = {
        pane_id: paneId,
        terminal_id: `fterm-${paneId}`,
        workspace_id: workspaceId,
        tab_id: tabId,
        focused: params.focus ?? false,
        agent_status: "unknown",
        revision: 0,
        cwd: params.cwd,
        foreground_cwd: params.cwd,
      };
      workspaces.set(workspaceId, workspace);
      tabs.set(tabId, tab);
      panes.set(paneId, pane);
      if (params.focus) {
        focusedWorkspaceId = workspaceId;
        focusedTabId = tabId;
        focusedPaneId = paneId;
      }
      // Mirrors real herdr 0.8.2: workspace.create brings a tab and a root pane
      // with it, and the subscribe stream emits them pane -> workspace -> tab
      // (verified live against a running herdr), not creation order.
      emit({ event: "pane_created", data: { type: "pane_created", pane } });
      emit({ event: "workspace_created", data: { type: "workspace_created", workspace } });
      emit({ event: "tab_created", data: { type: "tab_created", tab } });
      return workspace;
    },
    async workspaceRename(workspaceId: string, label: string): Promise<WorkspaceInfo> {
      const existing = workspaces.get(workspaceId);
      if (!existing) throw new Error(`fake herdr: unknown workspace ${workspaceId}`);
      const next = { ...existing, label };
      workspaces.set(workspaceId, next);
      emit({
        event: "workspace_renamed",
        data: { type: "workspace_renamed", workspace_id: workspaceId, label },
      });
      return next;
    },
    async workspaceClose(workspaceId: string): Promise<void> {
      const existing = workspaces.get(workspaceId);
      if (!existing) throw new Error(`fake herdr: unknown workspace ${workspaceId}`);
      for (const [id, pane] of panes) {
        if (pane.workspace_id === workspaceId) panes.delete(id);
      }
      for (const [id, tab] of tabs) {
        if (tab.workspace_id === workspaceId) tabs.delete(id);
      }
      workspaces.delete(workspaceId);
      if (focusedWorkspaceId === workspaceId) focusedWorkspaceId = null;
      emit({
        event: "workspace_closed",
        data: { type: "workspace_closed", workspace_id: workspaceId, workspace: existing },
      });
    },
    async agentStart(params: {
      name: string;
      kind: string;
      paneId: string;
      timeoutMs?: number;
      args?: string[];
    }): Promise<PaneInfo> {
      if (failingAgentStartPanes.has(params.paneId))
        throw new Error(`fake herdr: agent.start failed for ${params.paneId}`);
      const pane = requirePane(params.paneId);
      // real herdr reports the agent *kind* here; the name only addresses the agent
      const next: PaneInfo = { ...pane, agent: params.kind, agent_status: "idle" };
      panes.set(params.paneId, next);
      emit({
        event: "pane_agent_detected",
        data: {
          type: "pane_agent_detected",
          pane_id: params.paneId,
          workspace_id: pane.workspace_id,
          agent: params.name,
          final_status: "idle",
        },
      });
      return next;
    },
    async paneList(workspaceId?: string | null): Promise<PaneInfo[]> {
      return [...panes.values()].filter(
        (p) => workspaceId == null || p.workspace_id === workspaceId,
      );
    },
    async paneLayout(paneId: string): Promise<PaneLayoutSnapshot> {
      if (failingLayoutPanes.has(paneId))
        throw new Error(`fake herdr: pane.layout failed for ${paneId}`);
      const layout = paneLayouts.get(paneId);
      if (!layout) throw new Error(`fake herdr: no layout configured for ${paneId}`);
      return layout;
    },
    async paneRead(paneId: string, _lines: number): Promise<string> {
      if (failingReadPanes.has(paneId))
        throw new Error(`fake herdr: pane.read failed for ${paneId}`);
      requirePane(paneId);
      return paneReadTexts.get(paneId) ?? "";
    },
    async agentPrompt(paneId: string, _text: string): Promise<AgentPromptOutcome> {
      const pane = requirePane(paneId);
      if (blockedPanes.has(paneId)) return { status: "agent_blocked" };
      return { status: "sent", agent: pane };
    },
    async notificationShow(params: {
      title: string;
      body?: string | null;
      sound?: "none" | "done" | "request";
    }): Promise<void> {
      if (failNextNotificationShow) {
        failNextNotificationShow = false;
        throw new Error("fake herdr: notification.show failed");
      }
      notificationsShown.push(params);
    },
    subscribe(handler: (event: HerdrEventEnvelope) => void): () => void {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    status(): HerdrStatus {
      return status;
    },
    onStatus(cb: (status: HerdrStatus) => void): () => void {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    close(): void {
      subscribers.clear();
      statusListeners.clear();
    },

    emit,

    focusPane(paneId: string): void {
      const pane = requirePane(paneId);
      const previousFocused = focusedPaneId;
      for (const [id, p] of panes) panes.set(id, { ...p, focused: id === paneId });
      focusedPaneId = paneId;
      const workspaceChanged = focusedWorkspaceId !== pane.workspace_id;
      const tabChanged = focusedTabId !== pane.tab_id;
      focusedWorkspaceId = pane.workspace_id;
      focusedTabId = pane.tab_id;
      if (previousFocused !== paneId) {
        emit({
          event: "pane_focused",
          data: { type: "pane_focused", pane_id: paneId, workspace_id: pane.workspace_id },
        });
      }
      if (workspaceChanged) {
        emit({
          event: "workspace_focused",
          data: { type: "workspace_focused", workspace_id: pane.workspace_id },
        });
      }
      if (tabChanged) {
        emit({
          event: "tab_focused",
          data: { type: "tab_focused", tab_id: pane.tab_id, workspace_id: pane.workspace_id },
        });
      }
    },

    setForegroundCwd(paneId: string, cwd: string | null): void {
      this.updatePane(paneId, { foreground_cwd: cwd });
    },

    closePane(paneId: string): void {
      const pane = requirePane(paneId);
      panes.delete(paneId);
      if (focusedPaneId === paneId) focusedPaneId = null;
      emit({
        event: "pane_closed",
        data: { type: "pane_closed", pane_id: paneId, workspace_id: pane.workspace_id },
      });
    },

    simulateAgentBlocked(paneId: string, blocked = true): void {
      if (blocked) blockedPanes.add(paneId);
      else blockedPanes.delete(paneId);
    },

    failAgentStart(paneId: string, fail = true): void {
      if (fail) failingAgentStartPanes.add(paneId);
      else failingAgentStartPanes.delete(paneId);
    },

    setStatus(next: HerdrStatus): void {
      status = next;
      for (const cb of statusListeners) {
        try {
          cb(status);
        } catch (err) {
          console.error("fake herdr: status listener threw", err);
        }
      }
    },

    updatePane(paneId: string, patch: Partial<PaneInfo>): void {
      const pane = requirePane(paneId);
      const next = { ...pane, ...patch, revision: pane.revision + 1 };
      panes.set(paneId, next);
      emit({ event: "pane_updated", data: { type: "pane_updated", pane: next } });
    },

    setForegroundCwdSilently(paneId: string, cwd: string | null): void {
      const pane = requirePane(paneId);
      panes.set(paneId, { ...pane, foreground_cwd: cwd });
    },
    setPaneSilently(paneId, patch) {
      const pane = panes.get(paneId);
      if (pane) panes.set(paneId, { ...pane, ...patch });
    },

    setPaneLayout(paneId: string, layout: PaneLayoutSnapshot): void {
      paneLayouts.set(paneId, layout);
    },

    failPaneLayout(paneId: string, fail = true): void {
      if (fail) failingLayoutPanes.add(paneId);
      else failingLayoutPanes.delete(paneId);
    },

    setPaneReadText(paneId: string, text: string): void {
      paneReadTexts.set(paneId, text);
    },

    failPaneRead(paneId: string, fail = true): void {
      if (fail) failingReadPanes.add(paneId);
      else failingReadPanes.delete(paneId);
    },

    notificationsShown,
    failNotificationShow(fail = true): void {
      failNextNotificationShow = fail;
    },
  };
}
