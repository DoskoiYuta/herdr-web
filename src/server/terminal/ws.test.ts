import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "bun:test";
import { WebSocket } from "ws";
import { createUpgradeRouter } from "../ws/upgrade";
import { spawnHerdr } from "./pty";
import { createTermWss } from "./ws";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function waitFor(ws: WebSocket, event: "open" | "close"): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}

describe("createTermWss (/ws/term integration)", () => {
  let server: ReturnType<typeof createServer> | undefined;
  let killed = false;

  afterEach(async () => {
    server?.close();
    server = undefined;
    killed = false;
  });

  async function start() {
    server = createServer();
    const router = createUpgradeRouter(server);
    const wss = createTermWss({
      spawn: (opts) => {
        const term = spawnHerdr({ ...opts, bin: "/bin/sh", argv: [] });
        return {
          ...term,
          kill: () => {
            killed = true;
            term.kill();
          },
        };
      },
    });
    router.add("/ws/term", wss);
    const port = await listen(server);
    return port;
  }

  test("input -> output, resize, exit message, and close on PTY exit", async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/term?session=default&cols=80&rows=24`);
    await waitFor(ws, "open");

    ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));

    const sawHi = new Promise<void>((resolve) => {
      ws.on("message", (data, isBinary) => {
        if (isBinary && data.toString().includes("hi")) resolve();
      });
    });
    ws.send(new TextEncoder().encode("echo hi\n"));
    await sawHi;

    const exitMsg = new Promise<{ type: string; code: number }>((resolve) => {
      ws.on("message", (data, isBinary) => {
        if (!isBinary) resolve(JSON.parse(data.toString()));
      });
    });
    const closed = waitFor(ws, "close");
    ws.send(new TextEncoder().encode("exit\n"));

    const msg = await exitMsg;
    expect(msg.type).toBe("exit");
    await closed;
  });

  test("kills the PTY when the client closes first", async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/term`);
    await waitFor(ws, "open");
    ws.close();
    await waitFor(ws, "close");
    await new Promise((r) => setTimeout(r, 50));
    expect(killed).toBe(true);
  });
});
