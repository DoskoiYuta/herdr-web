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

/** ページ一覧の行として表示できる長さに収める。 */
export const NOTE_TITLE_MAX_LENGTH = 200;
/** 1 ページの本文上限（文字数）。 */
export const NOTE_BODY_MAX_LENGTH = 1_000_000;

export const CreateNoteRequestSchema = v.object({
  repoKey: v.pipe(v.string(), v.minLength(1)),
  title: v.optional(v.pipe(v.string(), v.maxLength(NOTE_TITLE_MAX_LENGTH)), "無題"),
});
export type CreateNoteRequest = v.InferOutput<typeof CreateNoteRequestSchema>;

/** title/body の部分更新。どちらか一方だけでもよい。 */
export const UpdateNoteRequestSchema = v.object({
  title: v.optional(v.pipe(v.string(), v.maxLength(NOTE_TITLE_MAX_LENGTH))),
  body: v.optional(v.pipe(v.string(), v.maxLength(NOTE_BODY_MAX_LENGTH))),
});
export type UpdateNoteRequest = v.InferOutput<typeof UpdateNoteRequestSchema>;
