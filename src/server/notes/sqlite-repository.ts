import { asc, eq } from "drizzle-orm";
import type { Note } from "../../contract/notes";
import type { Db } from "../db/client";
import { notes } from "../db/schema";
import type { NotesRepository } from "./ports";

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

    async delete(id) {
      await db.delete(notes).where(eq(notes.id, id));
    },
  };
}
