/**
 * `useSyncExternalStore`-based store holding the client's view of herdr state
 * (plan.md §6.4, §6.6, §9.2). Wired to `/ws/events` via `eventsSocket.ts` from
 * `App.tsx`; consumed by the sidebar and `App`'s focus-follow logic.
 */
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

export type HerdrStoreState = {
  repos: Repo[];
  focus: FocusMessage | null;
  herdr: { connected: boolean; protocol: number | null };
  connection: EventsSocketStatus;
  repoChanged: { root: string; head: string | null; tick: number } | null;
};

export type HerdrStore = {
  getState: () => HerdrStoreState;
  subscribe: (cb: () => void) => () => void;
  subscribeReviewEvents: (cb: (event: ReviewEvent) => void) => () => void;
  getReviewEvents: () => ReviewEvent[];
  send: (message: ClientEventMessage) => void;
  open: () => void;
  close: () => void;
};

const INITIAL_STATE: HerdrStoreState = {
  repos: [],
  focus: null,
  herdr: { connected: false, protocol: null },
  connection: "connecting",
  repoChanged: null,
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
        const prev = state.repoChanged;
        const tick = prev && prev.root === message.worktreeRoot ? prev.tick + 1 : 1;
        setState({
          ...state,
          repoChanged: { root: message.worktreeRoot, head: message.head, tick },
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
    send: (m) => handle?.send(m),
    open,
    close,
  };
}

/** React binding: subscribes the component to store changes via `useSyncExternalStore`. */
export function useHerdrStore(store: HerdrStore): HerdrStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
