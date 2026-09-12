import { chmod, readFile as fsReadFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ReadOnlyReason, WriteFileErrorCode, WriteFileResponse } from "../../contract/fs";
import { gitBlobHash } from "../git/blobHash";
import { MAX_FILE_BYTES, readOnlyReason, resolveWorktreeFile } from "./readFile";

export type WriteWorktreeFileStatus = 200 | 400 | 404 | 409 | 413 | 422;

export interface WriteWorktreeFileResult {
  status: WriteWorktreeFileStatus;
  body:
    | WriteFileResponse
    | { error: Exclude<WriteFileErrorCode, "conflict" | "read-only"> }
    | { error: "conflict"; hash: string }
    | { error: "read-only"; reason: ReadOnlyReason };
}

// Per-real-path (post-symlink-resolution, post-realpath) FIFO chain: a
// same-path PUT that arrives while another is still reading+hashing+writing
// must wait, not interleave — otherwise two concurrent writes can both pass
// the baseHash check against the same pre-write content and both "succeed",
// silently losing one of them. Keying by `resolveWorktreeFile`'s resolved
// real path (rather than the raw `root`/`path` strings) means two requests
// that spell the same file differently (a trailing slash on `root`, a `./`
// in `path`, or two `root`s that both contain it via a sub-repo) still
// serialize against each other.
const writeLocks = new Map<string, Promise<unknown>>();

function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeLocks.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const settled: Promise<unknown> = run.then(
    () => undefined,
    () => undefined,
  );
  writeLocks.set(key, settled);
  return run.finally(() => {
    if (writeLocks.get(key) === settled) writeLocks.delete(key);
  });
}

/**
 * Pure decision + IO for PUT /api/fs/file: overwrite one existing worktree
 * file. Never creates a new file (v1 scope). Writes via a same-directory
 * temp file + rename so a process death mid-write never leaves a
 * truncated file at `path` — a broken hardlink to the old inode is an
 * accepted side effect.
 */
export async function writeWorktreeFile(
  root: string,
  path: string,
  contents: string,
  baseHash: string,
): Promise<WriteWorktreeFileResult> {
  const nextBuf = Buffer.from(contents, "utf8");
  if (nextBuf.byteLength > MAX_FILE_BYTES) {
    return { status: 413, body: { error: "too-large" } };
  }

  // Resolving before taking the lock is safe (read-only, no side effects)
  // and gives the lock a stable, canonical key.
  const resolved = await resolveWorktreeFile(root, path);
  if (!resolved.ok) {
    return { status: resolved.status as 400 | 404, body: { error: resolved.error } };
  }

  return withWriteLock(resolved.real, async () => {
    const currentBuf = await fsReadFile(resolved.real);
    const reason = await readOnlyReason(root, path, resolved.real, currentBuf);
    if (reason !== null) {
      return { status: 422, body: { error: "read-only", reason } };
    }

    const currentHash = gitBlobHash(currentBuf);
    if (currentHash !== baseHash) {
      return { status: 409, body: { error: "conflict", hash: currentHash } };
    }

    const mode = (await stat(resolved.real)).mode & 0o777;
    const tmpPath = `${dirname(resolved.real)}/.${basename(resolved.real)}.${Bun.randomUUIDv7()}.tmp`;
    try {
      await writeFile(tmpPath, nextBuf);
      await chmod(tmpPath, mode);
      await rename(tmpPath, resolved.real);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    return { status: 200, body: { hash: gitBlobHash(nextBuf), size: nextBuf.byteLength } };
  });
}
