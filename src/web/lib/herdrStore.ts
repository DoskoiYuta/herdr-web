/**
 * `useSyncExternalStore`-based store holding the client's view of herdr state
 * (plan.md §6.4, §6.6, §9.2). Wired to `/ws/events` via `eventsSocket.ts` from
 * `App.tsx`; consumed by the sidebar and `App`'s focus-follow logic.
 */
import type { AskEvent } from "@contract/ask";
import type { DecisionEvent } from "@contract/decision";
import type {
  ClientEventMessage,
  FocusMessage,
  HerdrStatusMessage,
  Repo,
  ReviewMessage,
  ReviewNotifyMessage,
  ServerEventMessage,
} from "@contract/events";
import { useSyncExternalStore } from "react";
import { connectEvents, type EventsSocketStatus } from "./eventsSocket";
import { reduceRepos } from "./herdrReducer";

export type ReviewEvent = ReviewMessage | ReviewNotifyMessage;

const REVIEW_RING_SIZE = 50;
const ASK_RING_SIZE = 50;
const DECISION_RING_SIZE = 50;

export type RepoChangedEntry = { head: string | null; tick: number };

export type HerdrStoreState = {
  repos: Repo[];
  focus: FocusMessage | null;
  herdr: { connected: boolean; protocol: number | null };
  connection: EventsSocketStatus;
  /** Per-worktree-root `repo-changed` tick (keyed by `worktreeRoot`), so a
   * `usePatch` consumer watching one repo's tick never has it reset by a
   * `repo-changed` event for a *different* repo interleaving in between —
   * each root's counter is independently monotonic. */
  repoChanged: Record<string, RepoChangedEntry>;
};

export type HerdrStore = {
  getState: () => HerdrStoreState;
  subscribe: (cb: () => void) => () => void;
  subscribeReviewEvents: (cb: (event: ReviewEvent) => void) => () => void;
  getReviewEvents: () => ReviewEvent[];
  /** 「質問」(ask) events, forwarded the same way review events are (mirrors `subscribeReviewEvents`). */
  subscribeAskEvents: (cb: (event: AskEvent) => void) => () => void;
  getAskEvents: () => AskEvent[];
  /** 判断依頼 (decision) events, forwarded the same way ask events are (F13). */
  subscribeDecisionEvents: (cb: (event: DecisionEvent) => void) => () => void;
  getDecisionEvents: () => DecisionEvent[];
  send: (message: ClientEventMessage) => void;
  open: () => void;
  close: () => void;
};

const INITIAL_STATE: HerdrStoreState = {
  repos: [],
  focus: null,
  herdr: { connected: false, protocol: null },
  connection: "connecting",
  repoChanged: {},
};

export type CreateHerdrStoreOptions = {
  location?: { protocol: string; host: string };
  WebSocketImpl?: typeof WebSocket;
  /** false なら open() を呼ぶまで接続しない（React effect から張る用） */
  autoOpen?: boolean;
};

export function createHerdrStore(opts: CreateHerdrStoreOptions = {}): HerdrStore {
  const loc = opts.location ?? { protocol: window.location.protocol, host: window.location.host };

  let state: HerdrStoreState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const reviewListeners = new Set<(event: ReviewEvent) => void>();
  const reviewEvents: ReviewEvent[] = [];
  const askListeners = new Set<(event: AskEvent) => void>();
  const askEvents: AskEvent[] = [];
  const decisionListeners = new Set<(event: DecisionEvent) => void>();
  const decisionEvents: DecisionEvent[] = [];

  function setState(next: HerdrStoreState) {
    state = next;
    for (const cb of listeners) cb();
  }

  function handleMessage(message: ServerEventMessage) {
    switch (message.type) {
      case "tree":
      case "pane-updated":
      case "pane-removed":
        setState({ ...state, repos: reduceRepos(state.repos, message) });
        return;
      case "focus":
        setState({ ...state, focus: message });
        return;
      case "herdr": {
        const herdr: HerdrStatusMessage = message;
        setState({ ...state, herdr: { connected: herdr.connected, protocol: herdr.protocol } });
        return;
      }
      case "repo-changed": {
        const prev = state.repoChanged[message.worktreeRoot];
        const tick = (prev?.tick ?? 0) + 1;
        setState({
          ...state,
          repoChanged: {
            ...state.repoChanged,
            [message.worktreeRoot]: { head: message.head, tick },
          },
        });
        return;
      }
      case "review":
      case "review-notify": {
        reviewEvents.push(message);
        while (reviewEvents.length > REVIEW_RING_SIZE) reviewEvents.shift();
        for (const cb of reviewListeners) cb(message);
        return;
      }
      case "ask": {
        askEvents.push(message);
        while (askEvents.length > ASK_RING_SIZE) askEvents.shift();
        for (const cb of askListeners) cb(message);
        return;
      }
      case "decision": {
        decisionEvents.push(message);
        while (decisionEvents.length > DECISION_RING_SIZE) decisionEvents.shift();
        for (const cb of decisionListeners) cb(message);
        return;
      }
      default: {
        const exhaustiveCheck: never = message;
        return exhaustiveCheck;
      }
    }
  }

  // 接続は open() で張り、close() で落とす。React StrictMode の effect 二重実行
  // （mount → cleanup → mount）に耐えるよう、close 後に再度 open できる。
  let handle: ReturnType<typeof connectEvents> | null = null;
  function open(): void {
    if (handle) return;
    handle = connectEvents(loc, {
      onMessage: handleMessage,
      onStatus: (connection) => setState({ ...state, connection }),
      WebSocketImpl: opts.WebSocketImpl,
    });
  }
  function close(): void {
    handle?.close();
    handle = null;
  }
  if (opts.autoOpen !== false) open();

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    subscribeReviewEvents(cb) {
      reviewListeners.add(cb);
      return () => reviewListeners.delete(cb);
    },
    getReviewEvents: () => [...reviewEvents],
    subscribeAskEvents(cb) {
      askListeners.add(cb);
      return () => askListeners.delete(cb);
    },
    getAskEvents: () => [...askEvents],
    subscribeDecisionEvents(cb) {
      decisionListeners.add(cb);
      return () => decisionListeners.delete(cb);
    },
    getDecisionEvents: () => [...decisionEvents],
    send: (m) => handle?.send(m),
    open,
    close,
  };
}

/** React binding: subscribes the component to store changes via `useSyncExternalStore`. */
export function useHerdrStore(store: HerdrStore): HerdrStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
