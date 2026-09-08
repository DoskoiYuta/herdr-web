import { describe, expect, test } from "bun:test";
import type { Note } from "../../contract/notes";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { createSqliteNotesRepository } from "./sqlite-repository";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    repoKey: "/repo/.git",
    title: "TODO",
    body: "- [ ] a",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("createSqliteNotesRepository", () => {
  // 無いと壊れる: title/body の保存/復元が往復で壊れ、ページ内容が読み出せなくなる。
  test("round-trips a note through save/get", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    const note = makeNote();
    await repo.save(note);
    expect(await repo.get(note.id)).toEqual(note);
  });

  // 無いと壊れる: 更新後の再 save が別行として二重に増えたり、古い内容のまま
  // 上書きされなかったりして編集が保存されない。
  test("save on an existing id overwrites rather than duplicating", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    const note = makeNote();
    await repo.save(note);
    await repo.save({ ...note, body: "- [x] a" });
    expect(await repo.listByRepo(note.repoKey)).toHaveLength(1);
    expect((await repo.get(note.id))?.body).toBe("- [x] a");
  });

  // 無いと壊れる: 別リポジトリのノートが一覧に混ざり、worktree を跨いだ
  // リポジトリ単位の分離ができない。
  test("listByRepo only returns notes for the given repoKey, ordered by createdAt", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    await repo.save(
      makeNote({ id: "a", repoKey: "/repo-a", createdAt: "2026-09-05T00:00:02.000Z" }),
    );
    await repo.save(
      makeNote({ id: "b", repoKey: "/repo-a", createdAt: "2026-09-05T00:00:01.000Z" }),
    );
    await repo.save(
      makeNote({ id: "c", repoKey: "/repo-b", createdAt: "2026-09-05T00:00:00.000Z" }),
    );

    expect((await repo.listByRepo("/repo-a")).map((n) => n.id)).toEqual(["b", "a"]);
  });

  // 無いと壊れる: get→merge→save の read-modify-write に戻すと、同時に来た
  // 2 件の PATCH の一方が他方の書き込みを消しうる。1 本の UPDATE で書けている
  // ことを、指定していない列（title）が変わらないことで確認する。
  test("updateFields updates only the given columns in one statement", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    await repo.save(makeNote());
    const updated = await repo.updateFields("note-1", {
      body: "- [x] a",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(updated).toEqual({
      id: "note-1",
      repoKey: "/repo/.git",
      title: "TODO",
      body: "- [x] a",
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
  });

  // 無いと壊れる: 存在しない id への updateFields が例外を投げるか、
  // 気づかれずに何も更新しないまま成功したように見える。
  test("updateFields returns null for a missing id", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    expect(await repo.updateFields("missing", { title: "x", updatedAt: "t" })).toBeNull();
  });

  // 無いと壊れる: 削除がページ一覧から消えず、ユーザーが消したはずのページが
  // 残り続ける。
  test("delete removes the note", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    const repo = createSqliteNotesRepository(db);
    const note = makeNote();
    await repo.save(note);
    await repo.delete(note.id);
    expect(await repo.get(note.id)).toBeNull();
  });
});
