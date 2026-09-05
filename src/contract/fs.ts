import * as v from "valibot";

/** `root` is always a worktree/directory root absolute path — these are
 * plain filesystem operations, not git ones (see `contract/git.ts`). */

// ---------------------------------------------------------------------------
// /api/fs/ls  (file viewer: one directory's own entries, plain filesystem,
// no git filtering — lazily called per expanded directory)
// ---------------------------------------------------------------------------

export const LsQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  dir: v.optional(v.string()),
});
export type LsQuery = v.InferOutput<typeof LsQuerySchema>;

export const LsEntryKindSchema = v.picklist(["file", "dir", "symlink", "other"]);
export type LsEntryKind = v.InferOutput<typeof LsEntryKindSchema>;

export const LsEntrySchema = v.object({
  name: v.string(),
  kind: LsEntryKindSchema,
});
export type LsEntry = v.InferOutput<typeof LsEntrySchema>;

export const LsResponseSchema = v.object({
  /** `readdir(dir, { withFileTypes: true })`, sorted by name. Not recursive. */
  entries: v.array(LsEntrySchema),
});
export type LsResponse = v.InferOutput<typeof LsResponseSchema>;

export const LsErrorCodeSchema = v.picklist([
  "invalid-path",
  "outside-repo",
  "not-found",
  "not-a-directory",
]);
export type LsErrorCode = v.InferOutput<typeof LsErrorCodeSchema>;

// ---------------------------------------------------------------------------
// /api/fs/file  (file viewer: one worktree file, read-only)
// ---------------------------------------------------------------------------

export const FileQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  path: v.pipe(v.string(), v.minLength(1)),
});
export type FileQuery = v.InferOutput<typeof FileQuerySchema>;

export const FileResponseSchema = v.variant("kind", [
  v.object({
    kind: v.literal("text"),
    path: v.string(),
    contents: v.string(),
    /** bytes on disk */
    size: v.number(),
  }),
  v.object({ kind: v.literal("binary"), path: v.string(), size: v.number() }),
  v.object({ kind: v.literal("too-large"), path: v.string(), size: v.number() }),
]);
export type FileResponse = v.InferOutput<typeof FileResponseSchema>;

export const FileErrorCodeSchema = v.picklist([
  "invalid-path",
  "outside-repo",
  "not-found",
  "not-a-file",
]);
export type FileErrorCode = v.InferOutput<typeof FileErrorCodeSchema>;

// ---------------------------------------------------------------------------
// /api/fs/raw  (file viewer: image/PDF preview, raw bytes)
// ---------------------------------------------------------------------------

export const RawQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  path: v.pipe(v.string(), v.minLength(1)),
});
export type RawQuery = v.InferOutput<typeof RawQuerySchema>;

export const RawErrorCodeSchema = v.picklist([
  "invalid-path",
  "outside-repo",
  "not-found",
  "not-a-file",
  "unsupported",
  "too-large",
]);
export type RawErrorCode = v.InferOutput<typeof RawErrorCodeSchema>;

// ---------------------------------------------------------------------------
// /api/fs/upload  (file viewer: DnD import of files/folders, plain
// filesystem write — not a git op)
// ---------------------------------------------------------------------------

export const UploadQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  /** Directory relative to `root` files are written under; `""` = root. */
  dir: v.optional(v.string()),
  overwrite: v.optional(v.string()),
});
export type UploadQuery = v.InferOutput<typeof UploadQuerySchema>;

export const UploadResponseSchema = v.object({
  /** Paths relative to `dir`, `/`-separated, in the order written. */
  written: v.array(v.string()),
});
export type UploadResponse = v.InferOutput<typeof UploadResponseSchema>;

export const UploadErrorCodeSchema = v.picklist([
  "invalid-path",
  "outside-repo",
  "not-found",
  "not-a-directory",
  "not-a-file",
  "exists",
  "too-large",
]);
export type UploadErrorCode = v.InferOutput<typeof UploadErrorCodeSchema>;

// ---------------------------------------------------------------------------
// /api/fs/trash  (file viewer: move a worktree path to the OS trash)
// ---------------------------------------------------------------------------

export const TrashQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  path: v.string(),
});
export type TrashQuery = v.InferOutput<typeof TrashQuerySchema>;

export const TrashResponseSchema = v.object({
  /** The trashed path, relative to `root`, as passed in the request. */
  trashed: v.string(),
});
export type TrashResponse = v.InferOutput<typeof TrashResponseSchema>;

export const TrashErrorCodeSchema = v.picklist([
  "invalid-path",
  "outside-repo",
  "not-found",
  "forbidden-path",
  "no-trash-backend",
  "trash-failed",
]);
export type TrashErrorCode = v.InferOutput<typeof TrashErrorCodeSchema>;
