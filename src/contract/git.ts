import * as v from "valibot";

/** `repo` is always a worktree root absolute path. */

// ---------------------------------------------------------------------------
// /api/git/root
// ---------------------------------------------------------------------------

export const RootQuerySchema = v.object({
  path: v.pipe(v.string(), v.minLength(1)),
});
export type RootQuery = v.InferOutput<typeof RootQuerySchema>;

export const RootResponseSchema = v.object({
  root: v.string(),
  /** `git --git-common-dir`, made absolute + realpath'd. Doubles as the repo key. */
  commonDir: v.string(),
  branch: v.nullable(v.string()),
  isMain: v.boolean(),
  head: v.nullable(v.string()),
  /** oldest `rev-list --max-parents=0 HEAD` entry; null on an unborn branch. */
  rootCommit: v.nullable(v.string()),
});
export type RootResponse = v.InferOutput<typeof RootResponseSchema>;

// ---------------------------------------------------------------------------
// /api/git/patch
// ---------------------------------------------------------------------------

export const PatchQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
});
export type PatchQuery = v.InferOutput<typeof PatchQuerySchema>;

export const PatchFileSchema = v.object({
  name: v.string(),
  prevName: v.nullable(v.string()),
  /** sha1 (12 hex) of this file's patch fragment; drives per-file replacement. */
  hash: v.string(),
  oldHash: v.nullable(v.string()),
  newHash: v.nullable(v.string()),
  untracked: v.boolean(),
});
export type PatchFile = v.InferOutput<typeof PatchFileSchema>;

export const PatchResponseSchema = v.object({
  patch: v.string(),
  /** sha1 (12 hex) of the whole patch. */
  hash: v.string(),
  generatedAt: v.string(),
  files: v.array(PatchFileSchema),
  untrackedCount: v.number(),
  untrackedTruncated: v.boolean(),
  untrackedErrors: v.number(),
});
export type PatchResponse = v.InferOutput<typeof PatchResponseSchema>;

// ---------------------------------------------------------------------------
// /api/git/files
// ---------------------------------------------------------------------------

export const FilesQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
  path: v.pipe(v.string(), v.minLength(1)),
  prev: v.optional(v.string()),
  type: v.picklist(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  oldHash: v.optional(v.string()),
  newHash: v.optional(v.string()),
});
export type FilesQuery = v.InferOutput<typeof FilesQuerySchema>;

export const FileContentsSchema = v.object({
  name: v.string(),
  contents: v.string(),
  cacheKey: v.string(),
});
export type FileContents = v.InferOutput<typeof FileContentsSchema>;

export const FilesResponseSchema = v.object({
  oldFile: v.nullable(FileContentsSchema),
  newFile: v.nullable(FileContentsSchema),
});
export type FilesResponse = v.InferOutput<typeof FilesResponseSchema>;

export const FilesErrorCodeSchema = v.picklist([
  "invalid-path",
  "invalid-hash",
  "outside-repo",
  "not-found",
  "stale",
  "binary",
]);
export type FilesErrorCode = v.InferOutput<typeof FilesErrorCodeSchema>;

// ---------------------------------------------------------------------------
// /api/git/graph
// ---------------------------------------------------------------------------

export const GraphQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
  max: v.optional(v.string()),
  all: v.optional(v.string()),
});
export type GraphQuery = v.InferOutput<typeof GraphQuerySchema>;

export const CommitSchema = v.object({
  hash: v.string(),
  parents: v.array(v.string()),
  author: v.string(),
  authorEmail: v.string(),
  /** epoch seconds */
  authorDate: v.number(),
  committer: v.string(),
  /** epoch seconds */
  commitDate: v.number(),
  subject: v.string(),
  body: v.string(),
});
export type Commit = v.InferOutput<typeof CommitSchema>;

export const RefTypeSchema = v.picklist(["head", "remote", "tag", "stash"]);
export type RefType = v.InferOutput<typeof RefTypeSchema>;

export const RefSchema = v.object({
  /** shortened name, e.g. `main`, `origin/main`, `v1.0.0` */
  name: v.string(),
  /** full ref name, e.g. `refs/heads/main` */
  fullName: v.string(),
  type: RefTypeSchema,
  /** commit hash this ref points at, after peeling annotated tags */
  hash: v.string(),
  isHead: v.boolean(),
  upstream: v.optional(v.string()),
  ahead: v.optional(v.number()),
  behind: v.optional(v.number()),
});
export type Ref = v.InferOutput<typeof RefSchema>;

export const StashSchema = v.object({
  hash: v.string(),
  /** e.g. `stash@{0}` */
  selector: v.string(),
  subject: v.string(),
});
export type Stash = v.InferOutput<typeof StashSchema>;

export const HeadSchema = v.object({
  hash: v.string(),
  detached: v.boolean(),
  branch: v.optional(v.string()),
});
export type Head = v.InferOutput<typeof HeadSchema>;

export const GraphResponseSchema = v.object({
  repo: v.string(),
  commits: v.array(CommitSchema),
  refs: v.array(RefSchema),
  head: HeadSchema,
  stashes: v.array(StashSchema),
  hasUncommitted: v.boolean(),
  truncated: v.boolean(),
  generatedAt: v.string(),
});
export type GraphResponse = v.InferOutput<typeof GraphResponseSchema>;

// ---------------------------------------------------------------------------
// /api/git/commit/:hash
// ---------------------------------------------------------------------------

export const CommitParamSchema = v.object({
  hash: v.pipe(v.string(), v.minLength(1)),
});
export type CommitParam = v.InferOutput<typeof CommitParamSchema>;

export const CommitDetailQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
});
export type CommitDetailQuery = v.InferOutput<typeof CommitDetailQuerySchema>;

export const FileStatusSchema = v.picklist(["A", "M", "D", "R", "C", "T", "U"]);
export type FileStatus = v.InferOutput<typeof FileStatusSchema>;

export const CommitFileSchema = v.object({
  status: FileStatusSchema,
  path: v.string(),
  oldPath: v.optional(v.string()),
  /** Lines added; `null` for binary files (numstat reports `-`). */
  additions: v.nullable(v.number()),
  /** Lines deleted; `null` for binary files (numstat reports `-`). */
  deletions: v.nullable(v.number()),
});
export type CommitFile = v.InferOutput<typeof CommitFileSchema>;

export const CommitDetailSchema = v.object({
  ...CommitSchema.entries,
  files: v.array(CommitFileSchema),
});
export type CommitDetail = v.InferOutput<typeof CommitDetailSchema>;

// ---------------------------------------------------------------------------
// /api/git/fetch
// ---------------------------------------------------------------------------

export const FetchQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
});
export type FetchQuery = v.InferOutput<typeof FetchQuerySchema>;

export const FetchResultSchema = v.object({
  code: v.number(),
  stdout: v.string(),
  stderr: v.string(),
  durationMs: v.number(),
  timedOut: v.boolean(),
});
export type FetchResult = v.InferOutput<typeof FetchResultSchema>;

// ---------------------------------------------------------------------------
// /api/git/subrepos
// ---------------------------------------------------------------------------

export const SubReposQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
});
export type SubReposQuery = v.InferOutput<typeof SubReposQuerySchema>;

export const SubRepoKindSchema = v.picklist(["root", "submodule", "vcs"]);
export type SubRepoKind = v.InferOutput<typeof SubRepoKindSchema>;

export const SubRepoSchema = v.object({
  /** Path relative to `repo`, `/`-separated; `""` for `repo` itself. */
  id: v.string(),
  name: v.string(),
  /** Absolute, realpath'd. */
  root: v.string(),
  kind: SubRepoKindSchema,
});
export type SubRepo = v.InferOutput<typeof SubRepoSchema>;

export const SubReposResponseSchema = v.object({
  repos: v.array(SubRepoSchema),
});
export type SubReposResponse = v.InferOutput<typeof SubReposResponseSchema>;

// ---------------------------------------------------------------------------
// /api/git/status  (file viewer row decoration: worktree status vs HEAD/index)
// ---------------------------------------------------------------------------

export const StatusQuerySchema = v.object({
  repo: v.pipe(v.string(), v.minLength(1)),
});
export type StatusQuery = v.InferOutput<typeof StatusQuerySchema>;

export const TreeEntryStatusSchema = v.picklist([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
]);
export type TreeEntryStatus = v.InferOutput<typeof TreeEntryStatusSchema>;

export const TreeStatusEntrySchema = v.object({
  /** Path relative to `repo`, `/`-separated. */
  path: v.string(),
  status: TreeEntryStatusSchema,
});
export type TreeStatusEntry = v.InferOutput<typeof TreeStatusEntrySchema>;

export const StatusResponseSchema = v.object({
  /** Worktree status vs HEAD/index for paths that differ (from `git status --porcelain`). */
  status: v.array(TreeStatusEntrySchema),
});
export type StatusResponse = v.InferOutput<typeof StatusResponseSchema>;
