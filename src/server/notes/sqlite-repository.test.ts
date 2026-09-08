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
