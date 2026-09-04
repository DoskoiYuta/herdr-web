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

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe("GET /api/herdr/pane-preview", () => {
  // without this test, the send-target picker would have no way to show which
  // pane it's about to prompt, its workspace/tab, or a preview of its layout/output.
  test("returns the pane's info, workspace/tab labels, layout, and output tail", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    await settle();
    const workspace = await fake.workspaceCreate({ cwd, label: "ws-label" });
    const snapshot0 = await fake.snapshot();
    const paneId = snapshot0.panes.find((p) => p.workspace_id === workspace.workspace_id)!.pane_id;
    fake.updatePane(paneId, {
      agent: "claude",
      agent_status: "working",
      agent_session: { source: "herdr", agent: "claude", kind: "id", value: "sess-1" },
      label: "my pane",
    });
    fake.setPaneLayout(paneId, {
      workspace_id: workspace.workspace_id,
      tab_id: workspace.active_tab_id,
      zoomed: false,
      area: { x: 0, y: 0, width: 80, height: 24 },
      focused_pane_id: paneId,
      panes: [
        { pane_id: paneId, focused: true, rect: { x: 0, y: 0, width: 80, height: 24 } },
        { pane_id: "unknown-pane", focused: false, rect: { x: 80, y: 0, width: 80, height: 24 } },
      ],
      splits: [],
    });
    fake.setPaneReadText(paneId, ["", "line1", "", "line2", "line3"].join("\n"));

    const res = await app.request(`/api/herdr/pane-preview?pane=${paneId}`);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pane).toBe(paneId);
    expect(body.workspaceLabel).toBe("ws-label");
    expect(body.title).toBe("my pane");
    expect(body.agent).toBe("claude");
    expect(body.agentStatus).toBe("working");
    expect(body.agentSession).toBe("sess-1");
    expect(body.layout.area).toEqual({ x: 0, y: 0, width: 80, height: 24 });
    expect(body.layout.panes).toEqual([
      {
        paneId,
        focused: true,
        rect: { x: 0, y: 0, width: 80, height: 24 },
        title: "my pane",
        agent: "claude",
      },
      {
        paneId: "unknown-pane",
        focused: false,
        rect: { x: 80, y: 0, width: 80, height: 24 },
        title: null,
        agent: null,
      },
    ]);
    expect(body.tail).toEqual(["line1", "line2", "line3"]);
  });

  // without this test, requesting a preview for a pane id herdr-web doesn't know
  // about (already closed, or never existed) would fall through to a 500 instead
  // of the 404 the send-target picker needs to drop it from the list.
  test("404s for a pane the state store doesn't know about", async () => {
    const { app } = createTestApp();

    const res = await app.request("/api/herdr/pane-preview?pane=does-not-exist");

    expect(res.status).toBe(404);
  });

  // without this test, a herdr pane.layout/pane.read RPC failure (e.g. the pane
  // exited between the state snapshot and this request) would surface as a 500
  // instead of a degraded-but-still-useful preview.
  test("degrades layout to null and tail to [] when the gateway calls fail", async () => {
    const cwd = await makeDir();
    const { app, fake } = createTestApp({ allowedRoots: [cwd] });
    await settle();
    const workspace = await fake.workspaceCreate({ cwd, label: "ws-label" });
    const snapshot0 = await fake.snapshot();
    const paneId = snapshot0.panes.find((p) => p.workspace_id === workspace.workspace_id)!.pane_id;
    fake.updatePane(paneId, {});
    fake.failPaneLayout(paneId);
    fake.failPaneRead(paneId);

    const res = await app.request(`/api/herdr/pane-preview?pane=${paneId}`);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.layout).toBeNull();
    expect(body.tail).toEqual([]);
  });
});
