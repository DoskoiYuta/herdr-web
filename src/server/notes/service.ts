import { err, ok, type Result } from "neverthrow";
import type { Note } from "../../contract/notes";
import type { Clock, NotesRepository } from "./ports";

export type NotFoundError = { type: "not_found"; message: string };
function notFound(message: string): NotFoundError {
  return { type: "not_found", message };
}

export type NotesServiceDeps = {
  repository: NotesRepository;
  clock: Clock;
  generateId?: () => string;
};

export function createNotesService(deps: NotesServiceDeps) {
  const generateId = deps.generateId ?? (() => Bun.randomUUIDv7());

  async function listNotes(repoKey: string): Promise<Note[]> {
    return deps.repository.listByRepo(repoKey);
  }

  async function createNote(repoKey: string, title: string): Promise<Note> {
    const now = deps.clock.now().toISOString();
    const note: Note = {
      id: generateId(),
      repoKey,
      title,
      body: "",
      createdAt: now,
      updatedAt: now,
    };
    await deps.repository.save(note);
    return note;
  }

  async function updateNote(
    id: string,
    patch: { title?: string; body?: string },
  ): Promise<Result<Note, NotFoundError>> {
    // 1 本の UPDATE で書く（get→merge→save の read-modify-write だと、同時に
    // 来た 2 件の PATCH の一方が他方の書き込みを消しうる）。
    const updated = await deps.repository.updateFields(id, {
      ...patch,
      updatedAt: deps.clock.now().toISOString(),
    });
    if (!updated) return err(notFound(`note ${id} not found`));
    return ok(updated);
  }

  async function deleteNote(id: string): Promise<Result<void, NotFoundError>> {
    const note = await deps.repository.get(id);
    if (!note) return err(notFound(`note ${id} not found`));
    await deps.repository.delete(id);
    return ok(undefined);
  }

  return { listNotes, createNote, updateNote, deleteNote };
}

export type NotesService = ReturnType<typeof createNotesService>;
