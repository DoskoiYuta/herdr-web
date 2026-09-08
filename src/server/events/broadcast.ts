import { match } from "ts-pattern";
import type { ClientEventMessage, ServerEventMessage } from "../../contract/events";
import type { HerdrGateway } from "../herdr/gateway";
import type { FocusTracker } from "../herdr/focus";
import { effectiveCwd, type HerdrStateStore, type Logger } from "../herdr/state";
import {
  buildTree,
  livePanes,
  toPaneRow,
  type WorktreeInfo,
  type WorktreeResolver,
} from "../herdr/tree";

/** Abstraction over a `/ws/events` client connection, so the hub is testable without `ws`. */
export interface Sink {
  send(message: ServerEventMessage): void;
}

export interface EventHub {
  /** Register a connected client. Returns a detach function. */
  attach(sink: Sink): () => void;
  /** Send a message to every attached client. */
  broadcast(message: ServerEventMessage): void;
  /** Called for every newly attached sink — wireHerdrToHub uses this to push initial state to it alone. */
  onAttach(cb: (sink: Sink) => void): () => void;
}

/** Holds the set of connected `/ws/events` clients. The actual `ws` plumbing lives elsewhere (owned by another agent). */
export function createEventHub(): EventHub {
  const sinks = new Set<Sink>();
  const attachListeners = new Set<(sink: Sink) => void>();

  return {
    attach(sink) {
      sinks.add(sink);
      for (const cb of attachListeners) cb(sink);
      return () => sinks.delete(sink);
    },
    broadcast(message) {
      for (const sink of sinks) sink.send(message);
    },
    onAttach(cb) {
      attachListeners.add(cb);
      return () => attachListeners.delete(cb);
    },
  };
}

export interface WireHerdrToHubOptions {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  focus: FocusTracker;
  resolver: WorktreeResolver;
  hub: EventHub;
  logger?: Logger;
}

export interface WiredHerdr {
  /** Feed a parsed `{ type: "focus-pane" }` message from a client here (plan.md §9.2, §12-9). */
  handleClientMessage(message: ClientEventMessage): void;
  /** worktree の解決結果が変わりうるとき（HEAD / refs 変化）に tree を再送する。 */
  refreshTree(): void;
  stop(): void;
}

/**
 * Wires herdr state/focus into the event hub (plan.md deliverable 7): sends
 * `tree` to newly attached clients and whenever state resets, `pane-updated` /
 * `pane-removed` on granular pane changes, `focus` on focus changes, and
 * `herdr` on gateway connectivity changes. Also exposes `handleClientMessage`
 * for `focus-pane` from clients — it calls `workspace.focus`
 * first when the target pane's workspace differs from the currently focused
 * one (plan.md §12-9), then `pane.focus`.
 */
export function wireHerdrToHub(opts: WireHerdrToHubOptions): WiredHerdr {
  const { state, gateway, focus, resolver, hub, logger = console } = opts;

  // キャッシュは resolver 側（git/resolve.ts）が持つ。
  function resolveCached(cwd: string): Promise<WorktreeInfo | null> {
    return resolver.resolve(cwd).catch((err) => {
      logger.error("hub: worktree resolve failed", err);
      return null;
    });
  }

  async function currentTree() {
    const s = state.get();
    const cwds = new Set<string>();
    for (const pane of livePanes(s)) {
      const cwd = effectiveCwd(s, pane);
      if (cwd) cwds.add(cwd);
    }
    const resolved = new Map<string, WorktreeInfo | null>();
    await Promise.all(
      [...cwds].map(async (cwd) => {
        resolved.set(cwd, await resolveCached(cwd));
      }),
    );
    return buildTree(s, resolved);
  }

  async function sendTreeTo(sink: Sink): Promise<void> {
    sink.send({ type: "tree", repos: await currentTree() });
  }

  // herdr はフォーカス系イベントを毎秒何度も送るため、内容が変わったときだけ配信する
  let lastTreeJson: string | null = null;
  async function broadcastTree(): Promise<void> {
    const repos = await currentTree();
    const json = JSON.stringify(repos);
    if (json === lastTreeJson) return;
    lastTreeJson = json;
    hub.broadcast({ type: "tree", repos });
  }

  async function broadcastPaneUpdated(paneId: string): Promise<void> {
    const s = state.get();
    const pane = s.panes.get(paneId);
    // workspace 未登録の pane（閉じた直後の残骸や workspace_created 前の pane）は流さない。
    // 後者は workspace_created の reset で tree ごと送られる。
    if (!pane || !s.workspaces.has(pane.workspace_id)) return;
    const cwd = effectiveCwd(s, pane);
    const info = cwd ? await resolveCached(cwd) : null;
    hub.broadcast({
      type: "pane-updated",
      row: toPaneRow(pane, state.get()),
      worktreeRoot: info?.root ?? null,
      repoKey: info?.commonDir ?? null,
    });
  }

  const unsubscribeState = state.onChange((change) => {
    match(change)
      .with({ kind: "reset" }, () => void broadcastTree())
      .with({ kind: "pane" }, (c) => void broadcastPaneUpdated(c.paneId))
      .with({ kind: "pane-removed" }, (c) =>
        hub.broadcast({ type: "pane-removed", pane: c.paneId }),
      )
      .with({ kind: "focus" }, () => {})
      .with({ kind: "none" }, () => {})
      .exhaustive();
  });

  const unsubscribeFocus = focus.onChange((payload) => {
    hub.broadcast({ type: "focus", ...payload });
  });

  const unsubscribeStatus = gateway.onStatus((s) => {
    hub.broadcast({ type: "herdr", connected: s.connected, protocol: s.protocol });
  });

  const unsubscribeAttach = hub.onAttach((sink) => {
    void sendTreeTo(sink);
    sink.send({ type: "focus", ...focus.get() });
    const s = gateway.status();
    sink.send({ type: "herdr", connected: s.connected, protocol: s.protocol });
  });

  return {
    handleClientMessage(message: ClientEventMessage): void {
      match(message)
        .with({ type: "focus-pane" }, (m) => void handleFocusPane(m.pane))
        .exhaustive();
    },
    refreshTree(): void {
      void broadcastTree();
    },
    stop(): void {
      unsubscribeState();
      unsubscribeFocus();
      unsubscribeStatus();
      unsubscribeAttach();
    },
  };

  async function handleFocusPane(paneId: string): Promise<void> {
    try {
      const pane = state.get().panes.get(paneId);
      const focusedWorkspaceId = state.get().focusedWorkspaceId;
      if (pane && pane.workspace_id !== focusedWorkspaceId) {
        await gateway.workspaceFocus(pane.workspace_id);
      }
      await gateway.paneFocus(paneId);
    } catch (err) {
      logger.error("hub: focus-pane failed", err);
    }
  }
}
