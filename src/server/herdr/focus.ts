import type { FocusMessage } from "../../contract/events";
import type { PaneInfo } from "../../contract/herdr";
import type { HerdrGateway } from "./gateway";
import type { HerdrStateStore, Logger } from "./state";
import type { WorktreeInfo, WorktreeResolver } from "./tree";

export type FocusPayload = Omit<FocusMessage, "type">;

export interface FocusTracker {
  get(): FocusPayload;
  onChange(cb: (payload: FocusPayload) => void): () => void;
  /** Freeze the tool area on a worktree; pass null to unpin. Emits immediately either way. */
  pin(worktreeRoot: string | null): void;
  pinned(): string | null;
  /** worktree の解決結果が変わりうるとき（HEAD / refs 変化）に呼ぶ。再解決して変化があれば通知する。 */
  refresh(): void;
  stop(): void;
}

export interface CreateFocusTrackerOptions {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
  pollMs?: number;
  logger?: Logger;
}

const emptyPayload: FocusPayload = {
  pane: null,
  workspace: null,
  cwd: null,
  foregroundCwd: null,
  worktreeRoot: null,
  repoKey: null,
  agent: null,
  agentStatus: null,
  agentSession: null,
};

function effectiveCwd(pane: PaneInfo | undefined): string | null {
  return pane?.foreground_cwd ?? pane?.cwd ?? null;
}

/**
 * Computes the §9.2 `focus` payload from the herdr-state's currently focused pane,
 * re-resolving the worktree root when it changes (plan.md §6.4, deliverable 6).
 *
 * Polling fallback (§12-1): `foreground_cwd` changes are not guaranteed to fire
 * `pane.updated` on their own (see the live-herdr report in the socket-client
 * report for what we could actually verify), so while at least one listener is
 * attached we also poll `gateway.paneGet` on the focused pane every `pollMs`.
 */
export function createFocusTracker(opts: CreateFocusTrackerOptions): FocusTracker {
  const { state, gateway, resolver, pollMs = 3000, logger = console } = opts;

  let payload: FocusPayload = emptyPayload;
  let pinnedRoot: string | null = null;
  let lastKnownCwd: string | null = null;
  let lastKnownPaneId: string | null = null;
  let notifiedOnce = false;
  const listeners = new Set<(p: FocusPayload) => void>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let recomputing = Promise.resolve();

  // キャッシュは resolver 側（git/resolve.ts）が持つ。ここで持つと branch 変更を反映できない。
  function resolveCached(path: string): Promise<WorktreeInfo | null> {
    return resolver.resolve(path).catch((err) => {
      logger.error("focus: worktree resolve failed", err);
      return null;
    });
  }

  function notify(): void {
    for (const cb of listeners) {
      try {
        cb(payload);
      } catch (err) {
        logger.error("focus listener threw", err);
      }
    }
  }

  function recompute(paneOverride?: PaneInfo): void {
    recomputing = recomputing.then(() => doRecompute(paneOverride));
  }

  async function doRecompute(paneOverride?: PaneInfo): Promise<void> {
    const s = state.get();
    const paneId = s.focusedPaneId;
    const pane = paneOverride ?? (paneId ? s.panes.get(paneId) : undefined);
    const workspaceId = pane?.workspace_id ?? s.focusedWorkspaceId;
    const cwd = effectiveCwd(pane);

    lastKnownPaneId = paneId;
    lastKnownCwd = cwd;

    const info = cwd ? await resolveCached(cwd) : null;

    let worktreeRoot = info?.root ?? null;
    let repoKey = info?.commonDir ?? null;
    if (pinnedRoot !== null) {
      worktreeRoot = pinnedRoot;
      const pinnedInfo = await resolveCached(pinnedRoot);
      repoKey = pinnedInfo?.commonDir ?? repoKey;
    }

    const next: FocusPayload = {
      pane: pane?.pane_id ?? paneId,
      workspace: workspaceId ?? null,
      cwd: pane?.cwd ?? null,
      foregroundCwd: pane?.foreground_cwd ?? null,
      worktreeRoot,
      repoKey,
      agent: pane?.agent ?? null,
      agentStatus: pane?.agent_status ?? null,
      agentSession: pane?.agent_session ?? null,
    };
    // 同じ内容なら通知しない（herdr の focus 系イベントは高頻度）
    if (JSON.stringify(next) === JSON.stringify(payload) && notifiedOnce) return;
    payload = next;
    notifiedOnce = true;
    notify();
  }

  const unsubscribeState = state.onChange((change) => {
    if (change.kind === "reset" || change.kind === "focus") {
      recompute();
      return;
    }
    if (change.kind === "pane" && change.paneId === state.get().focusedPaneId) {
      recompute();
    }
    if (change.kind === "pane-removed" && change.paneId === lastKnownPaneId) {
      recompute();
    }
  });

  async function poll(): Promise<void> {
    const paneId = state.get().focusedPaneId;
    if (!paneId) return;
    try {
      const fresh = await gateway.paneGet(paneId);
      const cwd = effectiveCwd(fresh);
      if (paneId !== lastKnownPaneId || cwd !== lastKnownCwd) {
        recompute(fresh);
      }
    } catch (err) {
      logger.error("focus: poll failed", err);
    }
  }

  function ensurePolling(): void {
    if (pollTimer !== null || listeners.size === 0) return;
    pollTimer = setInterval(() => void poll(), pollMs);
  }

  function maybeStopPolling(): void {
    if (listeners.size === 0 && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  recompute();

  return {
    get: () => payload,
    onChange(cb) {
      listeners.add(cb);
      ensurePolling();
      return () => {
        listeners.delete(cb);
        maybeStopPolling();
      };
    },
    pin(worktreeRoot) {
      pinnedRoot = worktreeRoot;
      recompute();
    },
    pinned: () => pinnedRoot,
    refresh() {
      recompute();
    },
    stop() {
      unsubscribeState();
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
      listeners.clear();
    },
  };
}
