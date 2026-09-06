import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, test } from "bun:test";
import { procRoutes, type ProcRoutesDeps } from "./proc";
import type { ProcRunResult, ProcRunner } from "../proc/runner";
import { ProcCommandNotFoundError } from "../proc/runner";

const dirs: string[] = [];
const OK: ProcRunResult = { code: 0, stdout: "", stderr: "", timedOut: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-proc-routes-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function fakeRunner(overrides: Partial<ProcRunner> = {}): ProcRunner {
  return {
    ps: () => Promise.resolve(OK),
    lsofCwd: () => Promise.resolve(OK),
    lsofListen: () => Promise.resolve(OK),
    ...overrides,
  };
}

function makeApp(deps: ProcRoutesDeps) {
  return new Hono().route("/api/proc", procRoutes(deps));
}

describe("GET /api/proc/list", () => {
  test("a root outside allowedRoots is rejected as forbidden", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [], runner: fakeRunner() });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(403);
  });

  test("a non-existent root is reported not-found rather than forbidden", async () => {
    const app = makeApp({ allowedRoots: [], runner: fakeRunner() });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent("/no/such/dir")}`);

    expect(res.status).toBe(404);
  });

  test("no matching process yields an empty list, not an error", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir], runner: fakeRunner() });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ processes: [] });
  });

  test("a process whose cwd is root is returned", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({
        ps: () => Promise.resolve({ ...OK, stdout: "  100  1  0.0  1024 00:00:10 node app.js\n" }),
        lsofCwd: () => Promise.resolve({ ...OK, stdout: `p100\nn${dir}\n` }),
      }),
    });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    const body = await json(res);
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].pid).toBe(100);
  });

  test("lsof not installed (ENOENT) is reported as command-missing (501)", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({ lsofCwd: () => Promise.reject(new ProcCommandNotFoundError("lsof")) }),
    });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(501);
  });

  test("a non-zero exit from ps/lsof is reported as command-failed (503) with stderr", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({
        ps: () =>
          Promise.resolve({ code: 1, stdout: "", stderr: "permission denied", timedOut: false }),
      }),
    });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(503);
    expect((await json(res)).message).toContain("permission denied");
  });

  test("lsof exiting 1 with empty stdout/stderr (no LISTEN sockets at all) is an empty success, not a failure", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({
        ps: () => Promise.resolve({ ...OK, stdout: "  100  1  0.0  1024 00:00:10 node app.js\n" }),
        lsofCwd: () => Promise.resolve({ ...OK, stdout: `p100\nn${dir}\n` }),
        lsofListen: () => Promise.resolve({ code: 1, stdout: "", stderr: "", timedOut: false }),
      }),
    });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(200);
    expect((await json(res)).processes[0].listen).toEqual([]);
  });

  test("a timed-out scan is reported as timeout (504)", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({
        lsofListen: () => Promise.resolve({ code: -1, stdout: "", stderr: "", timedOut: true }),
      }),
    });

    const res = await app.request(`/api/proc/list?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(504);
  });
});
