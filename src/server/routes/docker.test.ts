import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, test } from "bun:test";
import { dockerRoutes, type DockerRoutesDeps } from "./docker";
import type { DockerRunResult, DockerRunner } from "../docker/runner";
import { DockerNotFoundError } from "../docker/runner";

const dirs: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-docker-routes-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function fakeRunner(result: DockerRunResult | Error): DockerRunner {
  return { ps: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)) };
}

function makeApp(deps: DockerRoutesDeps) {
  return new Hono().route("/api/docker", dockerRoutes(deps));
}

function psLine(fields: {
  id: string;
  names: string;
  state: string;
  status: string;
  image: string;
  ports?: string;
  createdAt?: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  devcontainerLocalFolder?: string;
}): string {
  return [
    fields.id,
    fields.names,
    fields.state,
    fields.status,
    fields.image,
    fields.ports ?? "",
    fields.createdAt ?? "c",
    fields.composeProject ?? "",
    fields.composeService ?? "",
    fields.composeWorkingDir ?? "",
    fields.devcontainerLocalFolder ?? "",
  ].join("\t");
}

describe("GET /api/docker/containers", () => {
  test("a root outside allowedRoots is rejected as forbidden", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [],
      runner: fakeRunner({ code: 0, stdout: "", stderr: "", timedOut: false }),
    });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(403);
  });

  test("a non-existent root is reported not-found rather than forbidden", async () => {
    const app = makeApp({
      allowedRoots: [],
      runner: fakeRunner({ code: 0, stdout: "", stderr: "", timedOut: false }),
    });

    const res = await app.request(
      `/api/docker/containers?root=${encodeURIComponent("/no/such/dir")}`,
    );

    expect(res.status).toBe(404);
  });

  test("no containers tied to root yields an empty group list, not an error", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({ code: 0, stdout: "", stderr: "", timedOut: false }),
    });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ groups: [] });
  });

  test("a container whose compose working_dir is root is returned grouped", async () => {
    const dir = await makeDir();
    const stdout = psLine({
      id: "1",
      names: "app-1",
      image: "node",
      state: "running",
      status: "Up 1 hour",
      composeProject: "app",
      composeWorkingDir: dir,
    });
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({ code: 0, stdout, stderr: "", timedOut: false }),
    });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    const body = await json(res);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].containers[0].name).toBe("app-1");
  });

  test("docker not installed (ENOENT) is reported as command-missing (501)", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir], runner: fakeRunner(new DockerNotFoundError()) });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(501);
  });

  test("a non-zero exit (daemon unreachable) is reported as command-failed (503) with stderr", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({
        code: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
        timedOut: false,
      }),
    });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(503);
    expect((await json(res)).message).toContain("Cannot connect to the Docker daemon");
  });

  test("a timed-out run is reported as timeout (504)", async () => {
    const dir = await makeDir();
    const app = makeApp({
      allowedRoots: [dir],
      runner: fakeRunner({ code: -1, stdout: "", stderr: "", timedOut: true }),
    });

    const res = await app.request(`/api/docker/containers?root=${encodeURIComponent(dir)}`);

    expect(res.status).toBe(504);
  });
});
