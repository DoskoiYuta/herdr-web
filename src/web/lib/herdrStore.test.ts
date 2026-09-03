import { describe, expect, test, vi } from "vitest";
import { createHerdrStore } from "./herdrStore";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  sent: string[] = [];
  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }
  emit(type: string, ev: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }
  simulateMessage(data: unknown) {
    this.emit("message", { data });
  }
}

function createStore() {
  FakeWebSocket.instances = [];
  const store = createHerdrStore({
    location: { protocol: "http:", host: "localhost:8080" },
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
  const socket = FakeWebSocket.instances[0]!;
  socket.simulateOpen();
  return { store, socket };
}

describe("createHerdrStore", () => {
  test("starts with the initial empty state", () => {
    const { store } = createStore();
    expect(store.getState()).toMatchObject({
      repos: [],
      focus: null,
      herdr: { connected: false, protocol: null },
    });
  });

  test("updates connection status and notifies subscribers", () => {
    FakeWebSocket.instances = [];
    const store = createHerdrStore({
      location: { protocol: "http:", host: "localhost:8080" },
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const cb = vi.fn();
    store.subscribe(cb);
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(store.getState().connection).toBe("open");
    expect(cb).toHaveBeenCalled();
  });

  test("applies tree/pane-updated/pane-removed via the reducer", () => {
    const { store, socket } = createStore();
    socket.simulateMessage(
      JSON.stringify({
        type: "tree",
        repos: [
          {
            key: "k",
            name: "repo",
            worktrees: [
              {
                root: "/repo",
                branch: "main",
                isMain: true,
                panes: [
                  {
                    paneId: "p1",
                    workspaceId: "w1",
                    tabId: "t1",
                    label: null,
                    agent: null,
                    agentStatus: "idle",
                    terminalTitleStripped: null,
                    focused: false,
                    cwd: "/repo",
                    foregroundCwd: "/repo",
                  },
                ],
              },
            ],
            counts: { blocked: 0, done: 0 },
          },
        ],
      }),
    );
    expect(store.getState().repos).toHaveLength(1);

    socket.simulateMessage(JSON.stringify({ type: "pane-removed", pane: "p1" }));
    expect(store.getState().repos).toEqual([]);
  });

  test("stores the latest focus message", () => {
    const { store, socket } = createStore();
    const focus = {
      type: "focus",
      pane: "p1",
      workspace: "w1",
      cwd: "/repo",
      foregroundCwd: "/repo",
      worktreeRoot: "/repo",
      repoKey: "k",
      agent: "claude",
      agentStatus: "working",
      agentSession: null,
    };
    socket.simulateMessage(JSON.stringify(focus));
    expect(store.getState().focus).toEqual(focus);
  });

  test("herdr status message updates connected/protocol", () => {
    const { store, socket } = createStore();
    socket.simulateMessage(JSON.stringify({ type: "herdr", connected: true, protocol: 20 }));
    expect(store.getState().herdr).toEqual({ connected: true, protocol: 20 });
  });

  test("repo-changed increments tick per worktree, resets for a different worktree", () => {
    const { store, socket } = createStore();
    socket.simulateMessage(
      JSON.stringify({ type: "repo-changed", worktreeRoot: "/a", reason: "head", head: "aaa" }),
    );
    expect(store.getState().repoChanged).toEqual({ root: "/a", head: "aaa", tick: 1 });

    socket.simulateMessage(
      JSON.stringify({ type: "repo-changed", worktreeRoot: "/a", reason: "status", head: "bbb" }),
    );
    expect(store.getState().repoChanged).toEqual({ root: "/a", head: "bbb", tick: 2 });

    socket.simulateMessage(
      JSON.stringify({ type: "repo-changed", worktreeRoot: "/b", reason: "head", head: "ccc" }),
    );
    expect(store.getState().repoChanged).toEqual({ root: "/b", head: "ccc", tick: 1 });
  });

  test("review / review-notify messages feed the ring buffer and subscribers, without touching main state", () => {
    const { store, socket } = createStore();
    const events: unknown[] = [];
    store.subscribeReviewEvents((e) => events.push(e));

    socket.simulateMessage(
      JSON.stringify({ type: "review", event: "created", review: { id: "r1" } }),
    );
    socket.simulateMessage(
      JSON.stringify({ type: "review-notify", reviewId: "r1", result: "sent", pane: "p1" }),
    );

    expect(events).toHaveLength(2);
    expect(store.getReviewEvents()).toHaveLength(2);
  });

  test("ring buffer caps at 50 entries", () => {
    const { store, socket } = createStore();
    for (let i = 0; i < 55; i++) {
      socket.simulateMessage(
        JSON.stringify({ type: "review-notify", reviewId: `r${i}`, result: "sent", pane: null }),
      );
    }
    const events = store.getReviewEvents();
    expect(events).toHaveLength(50);
    expect((events[0] as { reviewId: string }).reviewId).toBe("r5");
    expect((events[49] as { reviewId: string }).reviewId).toBe("r54");
  });

  test("send() forwards to the underlying socket", () => {
    const { store, socket } = createStore();
    store.send({ type: "pin", worktreeRoot: "/repo" });
    expect(socket.sent).toEqual([JSON.stringify({ type: "pin", worktreeRoot: "/repo" })]);
  });
});
