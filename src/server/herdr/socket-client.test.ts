import { afterEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHerdrSocketClient } from "./socket-client";
import type { HerdrGateway } from "./gateway";

type Line = Record<string, unknown>;

/** A minimal NDJSON server standing in for herdr, for wire-level testing. */
class FakeHerdrServer {
  readonly socketPath: string;
  private server: net.Server;
  sockets = new Set<net.Socket>();
  onLine: (socket: net.Socket, line: Line) => void = () => {};

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (raw.trim()) this.onLine(socket, JSON.parse(raw));
        }
      });
      socket.on("close", () => this.sockets.delete(socket));
    });
  }

  listen(): Promise<void> {
    if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
    return new Promise((resolve) => this.server.listen(this.socketPath, resolve));
  }

  send(socket: net.Socket, obj: unknown): void {
    socket.write(JSON.stringify(obj) + "\n");
  }

  closeAllSockets(): void {
    for (const s of this.sockets) s.destroy();
  }

  stop(): Promise<void> {
    this.closeAllSockets();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function tmpSocketPath(): string {
  return path.join(
    os.tmpdir(),
    `herdr-web-test-${process.pid}-${Math.random().toString(36).slice(2)}.sock`,
  );
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

function quietLogger() {
  return { error: () => {}, warn: () => {}, info: () => {} };
}

/** A logger stub that records calls, for assertions on log content/count. */
function recordingLogger() {
  const calls = { error: [] as unknown[][], warn: [] as unknown[][], info: [] as unknown[][] };
  return {
    logger: {
      error: (...args: unknown[]) => {
        calls.error.push(args);
      },
      warn: (...args: unknown[]) => {
        calls.warn.push(args);
      },
      info: (...args: unknown[]) => {
        calls.info.push(args);
      },
    },
    calls,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Respond to ping and events.subscribe like real herdr (both connections open one each). */
function wireDefaultResponders(server: FakeHerdrServer): void {
  server.onLine = (socket, line) => {
    if (line.method === "ping") {
      server.send(socket, {
        id: line.id,
        result: { type: "pong", version: "0.8.2", protocol: 20 },
      });
    } else if (line.method === "events.subscribe") {
      server.send(socket, { id: line.id, result: { type: "subscription_started" } });
    }
  };
}

describe("createHerdrSocketClient", () => {
  test("connects, pings, and reports status with the protocol version", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    wireDefaultResponders(server);
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);
    expect(client.status()).toEqual({ connected: true, protocol: 20 });
  });

  test("correlates concurrent requests by id", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    server.onLine = (socket, line) => {
      if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.8.2", protocol: 20 },
        });
      } else if (line.method === "events.subscribe") {
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      } else if (line.method === "pane.get") {
        const params = line.params as { pane_id: string };
        // reply out of order to prove correlation isn't order-dependent
        setTimeout(
          () =>
            server.send(socket, {
              id: line.id,
              result: {
                type: "pane_info",
                pane: {
                  pane_id: params.pane_id,
                  terminal_id: "t1",
                  workspace_id: "w1",
                  tab_id: "t1",
                  focused: false,
                  agent_status: "idle",
                  revision: 1,
                },
              },
            }),
          params.pane_id === "p1" ? 20 : 5,
        );
      }
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client: HerdrGateway = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    const [a, b] = await Promise.all([client.paneGet("p1"), client.paneGet("p2")]);
    expect(a.pane_id).toBe("p1");
    expect(b.pane_id).toBe("p2");
  });

  test("unwraps the pane.layout / pane.read result envelopes herdr sends", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    server.onLine = (socket, line) => {
      if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.8.2", protocol: 20 },
        });
      } else if (line.method === "events.subscribe") {
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      } else if (line.method === "pane.layout") {
        server.send(socket, {
          id: line.id,
          result: {
            type: "pane_layout",
            layout: {
              workspace_id: "w1",
              tab_id: "t1",
              zoomed: false,
              area: { x: 0, y: 1, width: 80, height: 40 },
              focused_pane_id: "p1",
              panes: [
                { pane_id: "p1", focused: true, rect: { x: 0, y: 1, width: 80, height: 40 } },
              ],
              splits: [],
            },
          },
        });
      } else if (line.method === "pane.read") {
        server.send(socket, {
          id: line.id,
          result: {
            type: "pane_read",
            read: { pane_id: "p1", text: "last line", truncated: false },
          },
        });
      }
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client: HerdrGateway = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    const layout = await client.paneLayout("p1");
    expect(layout.panes.map((p) => p.pane_id)).toEqual(["p1"]);
    expect(await client.paneRead("p1", 5)).toBe("last line");
  });

  test("a request times out when the server never responds", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    server.onLine = (socket, line) => {
      if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.8.2", protocol: 20 },
        });
      } else if (line.method === "events.subscribe") {
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      }
      // pane.get: never respond
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
      requestTimeoutMs: 50,
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    await expect(client.paneGet("p1")).rejects.toThrow(/timed out/);
  });

  // F7: agent.prompt gets its own (longer) timeout, independent of requestTimeoutMs.
  test("agent.prompt uses agentPromptTimeoutMs, not requestTimeoutMs", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    server.onLine = (socket, line) => {
      if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.8.2", protocol: 20 },
        });
      } else if (line.method === "events.subscribe") {
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      }
      // agent.prompt: never respond
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
      requestTimeoutMs: 30, // would fire quickly if agent.prompt used this
      agentPromptTimeoutMs: 200,
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    const start = Date.now();
    await expect(client.agentPrompt("p1", "hi")).rejects.toThrow(/timed out after 200ms/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(150); // well past requestTimeoutMs=30
  });

  test("reconnects with backoff after the server drops the connection, and re-pings", async () => {
    const socketPath = tmpSocketPath();
    const server = new FakeHerdrServer(socketPath);
    wireDefaultResponders(server);
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath,
      logger: quietLogger(),
      backoffInitialMs: 20,
      backoffMaxMs: 100,
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    server.closeAllSockets();
    await waitFor(() => !client.status().connected);
    await waitFor(() => client.status().connected, 3000);
    expect(client.status().protocol).toBe(20);
  });

  test("reconnects once the socket appears after starting disconnected", async () => {
    const socketPath = tmpSocketPath();
    const client = createHerdrSocketClient({
      socketPath,
      logger: quietLogger(),
      backoffInitialMs: 20,
      backoffMaxMs: 50,
    });
    cleanups.push(() => client.close());
    expect(client.status().connected).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    const server = new FakeHerdrServer(socketPath);
    wireDefaultResponders(server);
    await server.listen();
    cleanups.push(() => server.stop());

    await waitFor(() => client.status().connected, 3000);
  });

  // Without this, snapshot could be requested before the subscription is
  // established, losing any change that happens in the gap between them.
  test("subscribes before pinging, and only reports connected after the subscribe ack", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    const methodOrder: string[] = [];
    let sawSubscribeAck = false;
    server.onLine = (socket, line) => {
      methodOrder.push(line.method as string);
      if (line.method === "events.subscribe") {
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      } else if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.9.0", protocol: 22 },
        });
      }
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
    });
    cleanups.push(() => client.close());
    client.onStatus((status) => {
      if (status.connected) sawSubscribeAck = methodOrder.includes("events.subscribe");
    });
    await waitFor(() => client.status().connected);

    expect(methodOrder.indexOf("events.subscribe")).toBeGreaterThanOrEqual(0);
    expect(methodOrder.indexOf("events.subscribe")).toBeLessThan(methodOrder.indexOf("ping"));
    expect(sawSubscribeAck).toBe(true);
  });

  test("subscribes on a dedicated connection and keeps streaming events after the ack", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    let subSocket: net.Socket | null = null;
    server.onLine = (socket, line) => {
      if (line.method === "ping") {
        server.send(socket, {
          id: line.id,
          result: { type: "pong", version: "0.8.2", protocol: 20 },
        });
      } else if (line.method === "events.subscribe") {
        subSocket = socket;
        server.send(socket, { id: line.id, result: { type: "subscription_started" } });
      }
    };
    await server.listen();
    cleanups.push(() => server.stop());

    const client = createHerdrSocketClient({
      socketPath: server.socketPath,
      logger: quietLogger(),
    });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);
    await waitFor(() => subSocket !== null);

    const received: unknown[] = [];
    const unsubscribe = client.subscribe((e) => received.push(e));
    cleanups.push(() => unsubscribe());

    server.send(subSocket!, {
      event: "pane_focused",
      data: { type: "pane_focused", pane_id: "w1:p1", workspace_id: "w1" },
    });
    server.send(subSocket!, {
      event: "pane_updated",
      data: {
        type: "pane_updated",
        pane: {
          pane_id: "w1:p1",
          terminal_id: "t1",
          workspace_id: "w1",
          tab_id: "t1",
          focused: true,
          agent_status: "working",
          revision: 3,
          foreground_cwd: "/tmp/x",
        },
      },
    });

    await waitFor(() => received.length === 2);
    expect((received[0] as { event: string }).event).toBe("pane_focused");
    expect((received[1] as { event: string }).event).toBe("pane_updated");
  });

  test("logs a connected message with the protocol on first successful ping", async () => {
    const server = new FakeHerdrServer(tmpSocketPath());
    wireDefaultResponders(server);
    await server.listen();
    cleanups.push(() => server.stop());

    const { logger, calls } = recordingLogger();
    const client = createHerdrSocketClient({ socketPath: server.socketPath, logger });
    cleanups.push(() => client.close());
    await waitFor(() => client.status().connected);

    const connectedLogs = calls.info.filter(
      (args) => typeof args[0] === "string" && /connected/.test(args[0]) && /20/.test(args[0]),
    );
    expect(connectedLogs.length).toBeGreaterThanOrEqual(1);
  });

  test("rate-limits the ENOENT subscribe-socket warning to once per disconnect period", async () => {
    // Point at a socket path that never exists: every reconnect attempt on the
    // subscribe connection fails with ENOENT, exercising the backoff loop.
    const socketPath = tmpSocketPath();
    const { logger, calls } = recordingLogger();
    const client = createHerdrSocketClient({
      socketPath,
      logger,
      backoffInitialMs: 15,
      backoffMaxMs: 30,
    });
    cleanups.push(() => client.close());

    // Let several reconnect attempts happen within this one disconnect period.
    await new Promise((r) => setTimeout(r, 200));

    const subscribeErrorWarnings = calls.warn.filter(
      (args) => args[0] === "herdr: subscribe socket error",
    );
    expect(subscribeErrorWarnings.length).toBe(1);
  });
});
