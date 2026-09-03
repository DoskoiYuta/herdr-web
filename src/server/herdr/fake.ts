import type {
  HerdrEventEnvelope,
  PaneInfo,
  PingResult,
  SessionSnapshot,
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
  setStatus(status: HerdrStatus): void;
  /** Directly mutate a pane record and emit `pane_updated` (for arbitrary field changes in tests). */
  updatePane(paneId: string, patch: Partial<PaneInfo>): void;
  /**
   * Mutate a pane's foreground_cwd WITHOUT emitting any event — simulates herdr
   * changing `foreground_cwd` silently, so `gateway.paneGet` polling is the only
   * way to observe it (plan.md §12-1 fallback).
   */
  setForegroundCwdSilently(paneId: string, cwd: string | null): void;
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
    async agentPrompt(paneId: string, _text: string): Promise<AgentPromptOutcome> {
      const pane = requirePane(paneId);
      if (blockedPanes.has(paneId)) return { status: "agent_blocked" };
      return { status: "sent", agent: pane };
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
  };
}
