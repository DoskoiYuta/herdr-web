import type { Note } from "../../contract/notes";

export interface NotesRepository {
  get(id: string): Promise<Note | null>;
  /** `createdAt` 昇順（plan: ページの並び順）。 */
  listByRepo(repoKey: string): Promise<Note[]>;
  save(note: Note): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
