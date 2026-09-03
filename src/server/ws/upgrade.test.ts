import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "bun:test";
import { WebSocket, WebSocketServer } from "ws";
import { createUpgradeRouter } from "./upgrade";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

describe("createUpgradeRouter", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    server?.close();
    server = undefined;
  });

  test("dispatches to the wss registered for the matching pathname", async () => {
    server = createServer();
    const router = createUpgradeRouter(server);
    const wss = new WebSocketServer({ noServer: true });
    router.add("/ws/echo", wss);

    wss.on("connection", (ws) => {
      ws.on("message", (data) => ws.send(data.toString()));
    });

    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/echo?foo=bar`);
    const opened = new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    await opened;
    const echoed = new Promise<string>((resolve) =>
      ws.once("message", (d) => resolve(d.toString())),
    );
    ws.send("hello");
    expect(await echoed).toBe("hello");
    ws.close();
  });

  test("destroys the socket for unregistered /ws/* paths", async () => {
    server = createServer();
    createUpgradeRouter(server);
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/unknown`);
    const closedOrErrored = new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });
    await closedOrErrored;
  });

  test("ignores upgrade requests outside /ws/ so other listeners (e.g. Vite HMR) can handle them", async () => {
    server = createServer();
    createUpgradeRouter(server);

    let sawOtherUpgrade = false;
    server.on("upgrade", (req, socket) => {
      if (!req.url?.startsWith("/ws/")) {
        sawOtherUpgrade = true;
        socket.destroy();
      }
    });

    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });
    expect(sawOtherUpgrade).toBe(true);
  });
});
