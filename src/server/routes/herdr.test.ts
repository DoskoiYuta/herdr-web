import { mkdtemp, rm } from "node:fs/promises";
import { realpath as realpathAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createTestApp } from "../testing/app-deps";

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-herdr-routes-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe("POST /api/herdr/workspace", () => {
  test("creates a workspace at an allowed cwd and returns its id", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });

    const res = await app.request("/api/herdr/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, label: "my-workspace", focus: true }),
    });

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(typeof body.workspaceId).toBe("string");

    const snapshot = await fake.snapshot();
    const created = snapshot.workspaces.find((w) => w.workspace_id === body.workspaceId);
    expect(created?.label).toBe("my-workspace");
  });

  test("rejects a cwd outside the allowed roots with 403", async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    const { app } = createTestApp({ allowedRoots: [cwd] });

    const res = await app.request("/api/herdr/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: outside, label: "nope" }),
    });

    expect(res.status).toBe(403);
  });

  test("returns 404 for a cwd that doesn't exist", async () => {
    const cwd = await makeDir();
    const { app } = createTestApp({ allowedRoots: [cwd] });

    const res = await app.request("/api/herdr/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: join(cwd, "missing"), label: "nope" }),
    });

    expect(res.status).toBe(404);
  });

  test("rejects an empty cwd with 400", async () => {
    const { app } = createTestApp();

    const res = await app.request("/api/herdr/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/herdr/workspace/:id/rename", () => {
  test("renames an existing workspace", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    const workspace = await fake.workspaceCreate({ cwd, label: "before" });

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "after" }),
    });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.workspace.label).toBe("after");

    const snapshot = await fake.snapshot();
    expect(snapshot.workspaces.find((w) => w.workspace_id === workspace.workspace_id)?.label).toBe(
      "after",
    );
  });

  test("rejects an empty label with 400", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    const workspace = await fake.workspaceCreate({ cwd, label: "before" });

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "" }),
    });

    expect(res.status).toBe(400);
  });

  test("returns 500 for an unknown workspace id", async () => {
    const { app } = createTestApp();

    const res = await app.request("/api/herdr/workspace/does-not-exist/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "after" }),
    });

    expect(res.status).toBe(500);
  });
});

describe("POST /api/herdr/workspace/:id/close", () => {
  test("closes an existing workspace when confirmed", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    const workspace = await fake.workspaceCreate({ cwd, label: "to-close" });

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });

    expect(res.status).toBe(200);
    const snapshot = await fake.snapshot();
    expect(
      snapshot.workspaces.find((w) => w.workspace_id === workspace.workspace_id),
    ).toBeUndefined();
  });

  test("rejects without confirm: true (400)", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    const workspace = await fake.workspaceCreate({ cwd, label: "to-close" });

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const snapshot = await fake.snapshot();
    expect(
      snapshot.workspaces.find((w) => w.workspace_id === workspace.workspace_id),
    ).toBeDefined();
  });
});
