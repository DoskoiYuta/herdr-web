import type { Note } from "../../contract/notes";

export type NoteFieldPatch = { title?: string; body?: string; updatedAt: string };

export interface NotesRepository {
  get(id: string): Promise<Note | null>;
  /** `createdAt` 昇順（plan: ページの並び順）。 */
  listByRepo(repoKey: string): Promise<Note[]>;
  save(note: Note): Promise<void>;
  /** `patch` に含まれる列だけを 1 本の UPDATE で書く — get→merge→save の
   * read-modify-write だと並行更新の一方が消える。id が無ければ null。 */
  updateFields(id: string, patch: NoteFieldPatch): Promise<Note | null>;
  delete(id: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
