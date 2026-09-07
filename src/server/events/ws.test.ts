import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import type { ClientEventMessage } from "../../contract/events";
import { createUpgradeRouter } from "../ws/upgrade";
import { createEventHub } from "./broadcast";
import { createEventsWss } from "./ws";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));
}

describe("createEventsWss", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  test("broadcasts hub messages and forwards valid client messages", async () => {
    const hub = createEventHub();
    const received: ClientEventMessage[] = [];
    server = createServer();
    const router = createUpgradeRouter(server);
    router.add(
      "/ws/events",
      createEventsWss({ hub, onClientMessage: (m) => received.push(m), logger: { warn() {} } }),
    );
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
    await waitOpen(ws);

    const p = nextMessage(ws);
    hub.broadcast({ type: "herdr", connected: true, protocol: 20 });
    expect(await p).toEqual({ type: "herdr", connected: true, protocol: 20 });

    ws.send("not json");
    ws.send(JSON.stringify({ type: "bogus" }));
    ws.send(JSON.stringify({ type: "focus-pane", pane: "w1:p1" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([{ type: "focus-pane", pane: "w1:p1" }]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    // detached: broadcasting must not throw
    hub.broadcast({ type: "herdr", connected: false, protocol: null });
  });
});
