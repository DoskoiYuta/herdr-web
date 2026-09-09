import { describe, expect, test } from "bun:test";
import type { Note } from "../../contract/notes";
import type { NotesRepository } from "./ports";
import { createNotesService } from "./service";

function fakeRepository(initial: Note[] = []): NotesRepository {
  const rows = new Map(initial.map((n) => [n.id, n]));
  return {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async listByRepo(repoKey) {
      return [...rows.values()]
        .filter((n) => n.repoKey === repoKey)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async listAll() {
      return [...rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async save(note) {
      rows.set(note.id, note);
    },
    async updateFields(id, patch) {
      const note = rows.get(id);
      if (!note) return null;
      const updated: Note = {
        ...note,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        updatedAt: patch.updatedAt,
      };
      rows.set(id, updated);
      return updated;
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

const clock = { now: () => new Date("2026-09-09T00:00:00.000Z") };

describe("createNotesService", () => {
  // 無いと壊れる: 新規作成が別リポジトリのノートまで返し、リポジトリ単位の
  // 分離という契約自体が成立しない。
  test("listNotes only returns notes for the given repoKey", async () => {
    const repository = fakeRepository([
      { id: "a", repoKey: "/repo-a", title: "A", body: "", createdAt: "t", updatedAt: "t" },
      { id: "b", repoKey: "/repo-b", title: "B", body: "", createdAt: "t", updatedAt: "t" },
    ]);
    const service = createNotesService({ repository, clock });
    expect((await service.listNotes("/repo-a")).map((n) => n.id)).toEqual(["a"]);
  });

  // 無いと壊れる: 新規ページの body が空文字列で初期化されず、一覧に増えたのに
  // エディタに前のページの内容が残って見える。
  test("createNote starts with an empty body and the given title", async () => {
    const repository = fakeRepository();
    const service = createNotesService({ repository, clock, generateId: () => "note-1" });
    const note = await service.createNote("/repo-a", "無題");
    expect(note).toEqual({
      id: "note-1",
      repoKey: "/repo-a",
      title: "無題",
      body: "",
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
    });
  });

  // 無いと壊れる: title だけの更新が body を巻き込んで消してしまい、
  // インライン title 編集のたびに本文が消える。
  test("updateNote patches only the given fields", async () => {
    const repository = fakeRepository([
      {
        id: "a",
        repoKey: "/repo-a",
        title: "old",
        body: "old body",
        createdAt: "t",
        updatedAt: "t",
      },
    ]);
    const service = createNotesService({ repository, clock });
    const result = await service.updateNote("a", { title: "new" });
    expect(result._unsafeUnwrap()).toEqual({
      id: "a",
      repoKey: "/repo-a",
      title: "new",
      body: "old body",
      createdAt: "t",
      updatedAt: "2026-09-09T00:00:00.000Z",
    });
  });

  // 無いと壊れる: 存在しない id への PATCH/DELETE が例外やサイレント no-op に
  // なり、呼び出し側（route）が 404 を返せない。
  test("updateNote and deleteNote report not_found for a missing id", async () => {
    const service = createNotesService({ repository: fakeRepository(), clock });
    expect((await service.updateNote("missing", { title: "x" })).isErr()).toBe(true);
    expect((await service.deleteNote("missing")).isErr()).toBe(true);
  });

  // 無いと壊れる: 削除後もページが一覧に残り続け、ユーザーが消したはずの
  // ページを開けてしまう。
  test("deleteNote removes the note from listNotes", async () => {
    const repository = fakeRepository([
      { id: "a", repoKey: "/repo-a", title: "A", body: "", createdAt: "t", updatedAt: "t" },
    ]);
    const service = createNotesService({ repository, clock });
    await service.deleteNote("a");
    expect(await service.listNotes("/repo-a")).toEqual([]);
  });
});
