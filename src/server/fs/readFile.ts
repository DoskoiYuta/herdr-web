import { lstat, readFile as fsReadFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { FileErrorCode, FileResponse, ReadOnlyReason } from "../../contract/fs";
import { gitBlobHash } from "../git/blobHash";
import { isBinary } from "../git/isBinary";
import { isGitInternalPath } from "./gitPath";
import { resolveInsideRoot } from "./resolveInsideRoot";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ReadWorktreeFileStatus = 200 | 400 | 404;

export interface ReadWorktreeFileResult {
  status: ReadWorktreeFileStatus;
  body: FileResponse | { error: FileErrorCode };
}

function isInvalidPath(path: string): boolean {
  if (path.includes("\0") || isAbsolute(path)) return true;
  return path.split("/").includes("..");
}

export type ResolveWorktreeFileError = { status: 400 | 403 | 404; error: FileErrorCode };
export type ResolveWorktreeFileResult =
  | { ok: true; real: string; size: number }
  | ({ ok: false } & ResolveWorktreeFileError);

/**
 * Shared path validation + containment + stat for both `/api/git/file` and
 * `/api/git/raw`: reject `..`/absolute/NUL paths, resolve symlinks, confirm
 * the result stays inside `root`, and reject directories.
 */
export async function resolveWorktreeFile(
  root: string,
  path: string,
): Promise<ResolveWorktreeFileResult> {
  if (isInvalidPath(path)) {
    return { ok: false, status: 400, error: "invalid-path" };
  }

  const abs = join(root, path);
  const inside = await resolveInsideRoot(root, abs);
  if (!inside.ok) {
    return {
      ok: false,
      status: inside.error === "not-found" ? 404 : 400,
      error: inside.error,
    };
  }

  const st = await stat(inside.real);
  if (st.isDirectory()) {
    return { ok: false, status: 400, error: "not-a-file" };
  }

  return { ok: true, real: inside.real, size: st.size };
}

/** True iff re-decoding `buf` as UTF-8 and re-encoding it round-trips exactly
 * — i.e. `buf` is valid UTF-8. `Buffer#toString("utf8")` silently replaces
 * invalid sequences with U+FFFD rather than throwing, so the only way to
 * detect a mis-decode is to check whether that substitution happened. */
function isValidUtf8(buf: Buffer): boolean {
  const decoded = buf.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(buf);
}

/**
 * Why a write back to `path` (`PUT /api/fs/file`) would be refused, if any.
 * `real` is `path`'s already-resolved, symlink-followed absolute path (from
 * `resolveWorktreeFile`) — the git-internal check runs against it, not the
 * caller-supplied `path`, so a `.` segment, a differently-cased `.git`, or a
 * symlink that resolves into `.git` can't slip past a literal string check
 * on the raw relative path.
 */
export async function readOnlyReason(
  root: string,
  path: string,
  real: string,
  buf: Buffer,
): Promise<ReadOnlyReason | null> {
  const realRoot = await realpath(root).catch(() => root);
  if (isGitInternalPath(realRoot, real)) return "git-internal";
  const st = await lstat(join(root, path));
  if (st.isSymbolicLink()) return "symlink";
  if (!isValidUtf8(buf)) return "not-utf8";
  return null;
}

/** Pure decision + IO for GET /api/git/file: read one worktree file, read-only. */
export async function readWorktreeFile(
  root: string,
  path: string,
): Promise<ReadWorktreeFileResult> {
  const resolved = await resolveWorktreeFile(root, path);
  if (!resolved.ok) {
    return { status: resolved.status as 400 | 404, body: { error: resolved.error } };
  }

  if (resolved.size > MAX_FILE_BYTES) {
    return { status: 200, body: { kind: "too-large", path, size: resolved.size } };
  }

  const buf = await fsReadFile(resolved.real);
  if (isBinary(buf)) {
    return { status: 200, body: { kind: "binary", path, size: resolved.size } };
  }

  const reason = await readOnlyReason(root, path, resolved.real, buf);
  return {
    status: 200,
    body: {
      kind: "text",
      path,
      contents: buf.toString("utf8"),
      size: resolved.size,
      hash: gitBlobHash(buf),
      editable: reason === null,
      ...(reason !== null ? { readOnlyReason: reason } : {}),
    },
  };
}
