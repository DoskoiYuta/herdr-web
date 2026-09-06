import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { realpath as realpathAsync } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { WebSocket } from "ws";
import { createUpgradeRouter } from "../ws/upgrade";
import type { DockerCache } from "./cache";
import { DockerNotFoundError } from "./runner";
import type { DockerRunResult } from "./runner";
import { createDockerLogsWss } from "./logsWs";
import type { DockerLogsExitEvent, DockerLogsProcess, SpawnDockerLogsOptions } from "./logsSpawn";

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-docker-logs-ws-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function fakeCache(result: DockerRunResult | Error): DockerCache {
  return {
    get: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
}

function psLineFor(id: string, workingDir: string): string {
  return [id, "app-1", "running", "Up", "image", "", "c", "proj", "svc", workingDir, ""].join("\t");
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function waitFor(ws: WebSocket, event: "open" | "close"): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
}

/** A fake `DockerLogsProcess` whose stdout/stderr/exit can be driven manually,
 * so tests can push chunks that split a line across two `data` events. */
function fakeProcess() {
  const stdoutCbs: ((chunk: Buffer) => void)[] = [];
  const stderrCbs: ((chunk: Buffer) => void)[] = [];
  const exitCbs: ((event: DockerLogsExitEvent) => void)[] = [];
  let killed = false;
  const proc: DockerLogsProcess = {
    onStdout: (cb) => stdoutCbs.push(cb),
    onStderr: (cb) => stderrCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    onError: () => {},
    kill: () => {
      killed = true;
    },
  };
  return {
    proc,
    pushStdout: (chunk: string) => stdoutCbs.forEach((cb) => cb(Buffer.from(chunk))),
    pushStderr: (chunk: string) => stderrCbs.forEach((cb) => cb(Buffer.from(chunk))),
    exit: (code: number) => exitCbs.forEach((cb) => cb({ code, signal: null })),
    isKilled: () => killed,
  };
}

async function start(opts: {
  allowedRoots: string[];
  cache: DockerCache;
  spawn: (opts: SpawnDockerLogsOptions) => DockerLogsProcess;
}) {
  const server = createServer();
  const router = createUpgradeRouter(server);
  const wss = createDockerLogsWss(opts);
  router.add("/ws/docker-logs", wss);
  const port = await listen(server);
  return { server, port };
}

describe("createDockerLogsWss (/ws/docker-logs integration)", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  test("a root outside allowedRoots closes with a forbidden error", async () => {
    const dir = await makeDir();
    const started = await start({
      allowedRoots: [],
      cache: fakeCache(new DockerNotFoundError()),
      spawn: () => fakeProcess().proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");

    const msg = await nextMessage(ws);

    expect(msg).toMatchObject({ type: "error", code: "forbidden" });
  });

  test("a non-existent root closes with a not-found error", async () => {
    const started = await start({
      allowedRoots: [],
      cache: fakeCache(new DockerNotFoundError()),
      spawn: () => fakeProcess().proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent("/no/such/dir")}&id=abc`,
    );
    await waitFor(ws, "open");

    const msg = await nextMessage(ws);

    expect(msg).toMatchObject({ type: "error", code: "not-found" });
  });

  test("docker unavailable while checking container membership closes with docker-unavailable", async () => {
    const dir = await makeDir();
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache(new DockerNotFoundError()),
      spawn: () => fakeProcess().proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");

    const msg = await nextMessage(ws);

    expect(msg).toMatchObject({ type: "error", code: "docker-unavailable" });
  });

  test("an id not tied to root closes with a forbidden error", async () => {
    const dir = await makeDir();
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache({
        code: 0,
        stdout: psLineFor("other-id", dir),
        stderr: "",
        timedOut: false,
      }),
      spawn: () => fakeProcess().proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");

    const msg = await nextMessage(ws);

    expect(msg).toMatchObject({ type: "error", code: "forbidden" });
  });

  test("stdout/stderr chunks are split into line messages even when a line spans two chunks", async () => {
    const dir = await makeDir();
    const fp = fakeProcess();
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache({ code: 0, stdout: psLineFor("abc", dir), stderr: "", timedOut: false }),
      spawn: () => fp.proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");
    // give the connection handler a tick to finish the async root/id check
    await new Promise((r) => setTimeout(r, 20));

    const line1 = nextMessage(ws);
    fp.pushStdout("hello ");
    fp.pushStdout("world\n");
    const msg1 = await line1;
    expect(msg1).toEqual({ type: "line", stream: "stdout", text: "hello world" });

    const line2 = nextMessage(ws);
    fp.pushStderr("oops\n");
    const msg2 = await line2;
    expect(msg2).toEqual({ type: "line", stream: "stderr", text: "oops" });
  });

  test("process exit sends an exit frame with the code and closes the socket", async () => {
    const dir = await makeDir();
    const fp = fakeProcess();
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache({ code: 0, stdout: psLineFor("abc", dir), stderr: "", timedOut: false }),
      spawn: () => fp.proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");
    await new Promise((r) => setTimeout(r, 20));

    const exitMsg = nextMessage(ws);
    const closed = waitFor(ws, "close");
    fp.exit(0);

    expect(await exitMsg).toEqual({ type: "exit", code: 0 });
    await closed;
  });

  test("closing the client socket kills the docker logs process", async () => {
    const dir = await makeDir();
    const fp = fakeProcess();
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache({ code: 0, stdout: psLineFor("abc", dir), stderr: "", timedOut: false }),
      spawn: () => fp.proc,
    });
    server = started.server;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc`,
    );
    await waitFor(ws, "open");
    await new Promise((r) => setTimeout(r, 20));

    ws.close();
    await waitFor(ws, "close");
    await new Promise((r) => setTimeout(r, 20));

    expect(fp.isKilled()).toBe(true);
  });

  test.each([
    [undefined, 200],
    ["9999999", 5000],
    ["not-a-number", 200],
    ["50", 50],
  ])("tail query %s is clamped to %i before spawning", async (rawTail, expected) => {
    const dir = await makeDir();
    let receivedTail: number | undefined;
    const started = await start({
      allowedRoots: [dir],
      cache: fakeCache({ code: 0, stdout: psLineFor("abc", dir), stderr: "", timedOut: false }),
      spawn: (opts) => {
        receivedTail = opts.tail;
        return fakeProcess().proc;
      },
    });
    server = started.server;
    const tailParam = rawTail === undefined ? "" : `&tail=${rawTail}`;
    const ws = new WebSocket(
      `ws://127.0.0.1:${started.port}/ws/docker-logs?root=${encodeURIComponent(dir)}&id=abc${tailParam}`,
    );
    await waitFor(ws, "open");
    await new Promise((r) => setTimeout(r, 20));

    expect(receivedTail).toBe(expected);
    ws.close();
  });
});
