import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpath as realpathAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { createTestApp } from "../testing/app-deps";
import { invalidateSubReposCache } from "../git/subrepos";
import { invalidateWorktreesCache } from "../git/worktrees";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-herdr-routes-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

async function makeRepo(): Promise<string> {
  const dir = await makeDir();
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await writeFile(join(dir, "a.txt"), "a\n");
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  invalidateSubReposCache();
  invalidateWorktreesCache();
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

describe("/api/herdr/workspace/:id/selection", () => {
  test("GET returns null when nothing is saved", async () => {
    const repo = await makeRepo();
    const { app } = createTestApp({ allowedRoots: [repo] });

    const res = await app.request(
      `/api/herdr/workspace/w1/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ selection: null });
  });

  test("PUT 400s with unknown_workspace when the workspace doesn't exist", async () => {
    const repo = await makeRepo();
    const { app } = createTestApp({ allowedRoots: [repo] });

    const res = await app.request("/api/herdr/workspace/no-such-ws/selection", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "unknown_workspace" });
  });

  test("PUT saves a valid top-worktree selection; GET then returns it", async () => {
    const repo = await makeRepo();
    const { app, fake } = createTestApp({ allowedRoots: [repo] });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.selection).toMatchObject({
      workspaceId: workspace.workspace_id,
      repoKey: `${repo}/.git`,
      worktreeRoot: repo,
      subRepoId: null,
      subWorktreeRoot: null,
    });

    const getRes = await app.request(
      `/api/herdr/workspace/${workspace.workspace_id}/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
    );
    expect((await json(getRes)).selection).toMatchObject({ worktreeRoot: repo });
  });

  // 無いと壊れる: root エントリの id ("") がそのまま subRepoId として保存され、
  // 「サブリポジトリ未選択 (null)」ではなく「id "" のサブリポジトリを選択中」の
  // 状態として読み戻ってしまう（実効解決で subRepo が求まらない不整合な選択になる）。
  test('PUT with subRepoId "" (the root entry\'s id) normalizes to null', async () => {
    const repo = await makeRepo();
    const { app, fake } = createTestApp({ allowedRoots: [repo] });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo, subRepoId: "" }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).selection).toMatchObject({ subRepoId: null, subWorktreeRoot: null });

    const getRes = await app.request(
      `/api/herdr/workspace/${workspace.workspace_id}/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
    );
    expect((await json(getRes)).selection).toMatchObject({ subRepoId: null });
  });

  // 無いと壊れる: 別リポジトリの worktree を渡しても保存され、後から実効解決
  // が repoKey と一致しない worktree に固定されてしまう。
  test("PUT 400s with worktree_not_in_repo when worktreeRoot belongs to a different repository", async () => {
    const repo = await makeRepo();
    const otherRepo = await makeRepo();
    const { app, fake } = createTestApp({ allowedRoots: [repo, otherRepo] });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: otherRepo }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "worktree_not_in_repo" });
  });

  test("PUT 400s with unknown_sub_repo when subRepoId doesn't exist under worktreeRoot", async () => {
    const repo = await makeRepo();
    const { app, fake } = createTestApp({ allowedRoots: [repo] });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repoKey: `${repo}/.git`,
        worktreeRoot: repo,
        subRepoId: "vendor/does-not-exist",
      }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "unknown_sub_repo" });
  });

  test("DELETE clears a saved selection; GET then returns null again", async () => {
    const repo = await makeRepo();
    const { app, fake } = createTestApp({ allowedRoots: [repo] });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo }),
    });

    const delRes = await app.request(
      `/api/herdr/workspace/${workspace.workspace_id}/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
      { method: "DELETE" },
    );
    expect(delRes.status).toBe(200);

    const getRes = await app.request(
      `/api/herdr/workspace/${workspace.workspace_id}/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
    );
    expect(await json(getRes)).toEqual({ selection: null });
  });

  // 無いと壊れる: resolveWorktree の（TTL 無し）キャッシュだけを信じると、PUT の
  // 後に worktree を消しても直前のキャッシュ結果でそのまま検証が通ってしまう。
  test("PUT 400s when the worktree directory is gone even though the resolver's cache still has it", async () => {
    const repo = await makeRepo();
    // Simulates a stale (no-TTL) resolveWorktree cache entry: always reports
    // success for `repo` regardless of whether it still exists on disk.
    const staleResolver = {
      resolve: async (path: string) => ({
        root: path,
        commonDir: `${repo}/.git`,
        branch: "main",
        isMain: true,
      }),
    };
    const { app, fake } = createTestApp({ allowedRoots: [repo], resolver: staleResolver });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    await rm(repo, { recursive: true, force: true });

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "worktree_not_in_repo" });
  });

  // 無いと壊れる: SQLite への書き込みが失敗しても PUT が 200 を返し、サーバー
  // 再起動やクラッシュ後に選択が黙って消える（メモリ上だけ更新されていた）。
  test("PUT 500s with persist_failed and reverts to the previous selection when the repository write fails", async () => {
    const repo = await makeRepo();
    const failingRepository = {
      async list() {
        return [];
      },
      async set(): Promise<void> {
        throw new Error("disk full");
      },
      async delete() {},
      async deleteByWorkspace() {},
    };
    const { app, fake } = createTestApp({
      allowedRoots: [repo],
      selectionRepository: failingRepository,
    });
    const workspace = await fake.workspaceCreate({ cwd: repo, focus: true });
    await settle();

    const res = await app.request(`/api/herdr/workspace/${workspace.workspace_id}/selection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoKey: `${repo}/.git`, worktreeRoot: repo }),
    });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: "persist_failed" });

    const getRes = await app.request(
      `/api/herdr/workspace/${workspace.workspace_id}/selection?repoKey=${encodeURIComponent(`${repo}/.git`)}`,
    );
    expect(await json(getRes)).toEqual({ selection: null }); // reverted: nothing was saved before
  });
});
