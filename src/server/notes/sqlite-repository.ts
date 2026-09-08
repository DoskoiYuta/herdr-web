import { asc, eq } from "drizzle-orm";
import type { Note } from "../../contract/notes";
import type { Db } from "../db/client";
import { notes } from "../db/schema";
import type { NoteFieldPatch, NotesRepository } from "./ports";

type NoteRow = typeof notes.$inferSelect;

function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    repoKey: row.repoKey,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSqliteNotesRepository(db: Db): NotesRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(notes).where(eq(notes.id, id));
      return row ? rowToNote(row) : null;
    },

    async listByRepo(repoKey) {
      const rows = await db
        .select()
        .from(notes)
        .where(eq(notes.repoKey, repoKey))
        .orderBy(asc(notes.createdAt));
      return rows.map(rowToNote);
    },

    async save(note) {
      await db.insert(notes).values(note).onConflictDoUpdate({ target: notes.id, set: note });
    },

    async updateFields(id, patch: NoteFieldPatch) {
      const set: Partial<NoteRow> = { updatedAt: patch.updatedAt };
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.body !== undefined) set.body = patch.body;
      const rows = await db.update(notes).set(set).where(eq(notes.id, id)).returning();
      return rows[0] ? rowToNote(rows[0]) : null;
    },

    async delete(id) {
      await db.delete(notes).where(eq(notes.id, id));
    },
  };
}
