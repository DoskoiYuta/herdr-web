import { describe, expect, test } from "bun:test";
import { createTestApp } from "../testing/app-deps";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function postNote(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  body: unknown = { repoKey: "/repo/.git" },
) {
  return app.request("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/notes", () => {
  // 無いと壊れる: `?repo=` を省略した不正なリクエストがそのまま処理されて
  // しまい、リポジトリ単位の分離という契約を route が検証しない。
  test("400 when repo query is missing", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/notes");
    expect(res.status).toBe(400);
  });

  // 無いと壊れる: 一覧が指定リポジトリ以外のノートも返し、他リポジトリの
  // ページが Notes タブに混ざって見える。
  test("returns only notes for the given repo", async () => {
    const { app } = createTestApp();
    await postNote(app, { repoKey: "/repo-a" });
    await postNote(app, { repoKey: "/repo-b" });
    const res = await app.request("/api/notes?repo=/repo-a");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(1);
    expect(body[0].repoKey).toBe("/repo-a");
  });
});

describe("POST /api/notes", () => {
  // 無いと壊れる: 新規作成がタイトル省略時に既定の「無題」を持たず、
  // 空のページが一覧に見出し無しで並ぶ。
  test("201 with a default title of 無題 when title is omitted", async () => {
    const { app } = createTestApp();
    const res = await postNote(app);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.title).toBe("無題");
    expect(body.body).toBe("");
  });
});

describe("PATCH /api/notes/:id", () => {
  // 無いと壊れる: 本文の自動保存 PATCH が届いても更新されず、編集内容が
  // 保存されない。
  test("200 with the updated note on success", async () => {
    const { app } = createTestApp();
    const created = await json(await postNote(app));
    const res = await app.request(`/api/notes/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "new body" }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).body).toBe("new body");
  });

  // 無いと壊れる: 存在しない id への PATCH が 200 を返し、呼び出し側が
  // 保存失敗に気づけない。
  test("404 for a missing id", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/notes/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/notes/:id", () => {
  // 無いと壊れる: 削除 API が無い/効かないと、右クリックの削除が一覧から
  // 消せない。
  test("204 on success, then the note is gone from the list", async () => {
    const { app } = createTestApp();
    const created = await json(await postNote(app, { repoKey: "/repo-a" }));
    const res = await app.request(`/api/notes/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const list = await json(await app.request("/api/notes?repo=/repo-a"));
    expect(list).toEqual([]);
  });

  test("404 for a missing id", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/notes/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
