import { readFile as fsReadFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { FileErrorCode, FileResponse } from "../../contract/fs";
import { isBinary } from "../git/isBinary";
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
  return {
    status: 200,
    body: { kind: "text", path, contents: buf.toString("utf8"), size: resolved.size },
  };
}
