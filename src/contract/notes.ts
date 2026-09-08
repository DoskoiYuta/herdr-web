import * as v from "valibot";

/**
 * Notes ツールタブ (docs/ui-redesign.md §5.4): リポジトリ単位
 * （`repoKey` = git-common-dir の realpath、reviews/asks と同じ）の複数ページ
 * markdown ノート。worktree を切り替えても同じリポジトリなら同じノートが見える。
 */
export const NoteSchema = v.object({
  id: v.string(),
  repoKey: v.string(),
  title: v.string(),
  body: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
});
export type Note = v.InferOutput<typeof NoteSchema>;

export const ListNoteQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
});
export type ListNoteQuery = v.InferOutput<typeof ListNoteQuerySchema>;

export const CreateNoteRequestSchema = v.object({
  repoKey: v.pipe(v.string(), v.minLength(1)),
  title: v.optional(v.string(), "無題"),
});
export type CreateNoteRequest = v.InferOutput<typeof CreateNoteRequestSchema>;

/** title/body の部分更新。どちらか一方だけでもよい。 */
export const UpdateNoteRequestSchema = v.object({
  title: v.optional(v.string()),
  body: v.optional(v.string()),
});
export type UpdateNoteRequest = v.InferOutput<typeof UpdateNoteRequestSchema>;
