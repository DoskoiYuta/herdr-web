import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildEventsSocketUrl, connectEvents } from "./eventsSocket";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
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

  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }
}

describe("buildEventsSocketUrl", () => {
  test("builds ws: for http, wss: for https", () => {
    expect(buildEventsSocketUrl({ protocol: "http:", host: "localhost:8080" })).toBe(
      "ws://localhost:8080/ws/events",
    );
    expect(buildEventsSocketUrl({ protocol: "https:", host: "example.com" })).toBe(
      "wss://example.com/ws/events",
    );
  });
});

describe("connectEvents", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("parses valid frames and forwards them to onMessage", () => {
    const onMessage = vi.fn();
    const onStatus = vi.fn();
    connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      { onMessage, onStatus, WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );
    const socket = FakeWebSocket.instances[0]!;
    socket.simulateOpen();
    expect(onStatus).toHaveBeenCalledWith("open");

    socket.simulateMessage(JSON.stringify({ type: "herdr", connected: true, protocol: 20 }));
    expect(onMessage).toHaveBeenCalledWith({ type: "herdr", connected: true, protocol: 20 });
  });

  test("drops invalid frames and warns instead of calling onMessage", () => {
    const onMessage = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      { onMessage, WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );
    const socket = FakeWebSocket.instances[0]!;
    socket.simulateOpen();

    socket.simulateMessage("not json");
    socket.simulateMessage(JSON.stringify({ type: "nope" }));
    socket.simulateMessage(JSON.stringify({ type: "herdr", connected: "yes" }));

    expect(onMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("send() only writes while the socket is open", () => {
    connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      { onMessage: vi.fn(), WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    ).send({ type: "pin", worktreeRoot: "/x" });
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.sent).toEqual([]);

    socket.simulateOpen();
    const handle = connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      { onMessage: vi.fn(), WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );
    const socket2 = FakeWebSocket.instances[1]!;
    socket2.simulateOpen();
    handle.send({ type: "focus-pane", pane: "p1" });
    expect(socket2.sent).toEqual([JSON.stringify({ type: "focus-pane", pane: "p1" })]);
  });

  test("reconnects with exponential backoff after a close, resetting after a successful open", () => {
    const onStatus = vi.fn();
    connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      {
        onMessage: vi.fn(),
        onStatus,
        WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        minBackoffMs: 500,
        maxBackoffMs: 10_000,
      },
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.simulateOpen();
    FakeWebSocket.instances[0]!.simulateClose();
    expect(onStatus).toHaveBeenCalledWith("reconnecting");

    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // second attempt fails immediately without opening -> backoff doubles to 1000ms
    FakeWebSocket.instances[1]!.simulateClose();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  test("close() stops reconnect attempts", () => {
    const handle = connectEvents(
      { protocol: "http:", host: "localhost:8080" },
      { onMessage: vi.fn(), WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket },
    );
    FakeWebSocket.instances[0]!.simulateOpen();
    handle.close();
    FakeWebSocket.instances[0]!.simulateClose();
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
