import { chmod, readFile as fsReadFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ReadOnlyReason, WriteFileErrorCode, WriteFileResponse } from "../../contract/fs";
import { gitBlobHash } from "../git/blobHash";
import { MAX_FILE_BYTES, readOnlyReason, resolveWorktreeFile } from "./readFile";

export type WriteWorktreeFileStatus = 200 | 400 | 403 | 404 | 409 | 413 | 422 | 500;

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

/** Classifies an I/O error thrown while writing, for the 403/404/500 tail
 * of `writeWorktreeFile`. `ENOENT` here means the file vanished from under
 * an already-validated write (a race outside this process' lock), so it's
 * folded into the same `not-found` the initial resolve would have given. */
function classifyWriteError(err: unknown): {
  status: 403 | 404 | 500;
  body: WriteWorktreeFileResult["body"];
} {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return { status: 404, body: { error: "not-found" } };
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return { status: 403, body: { error: "permission-denied" } };
  }
  return { status: 500, body: { error: "write-failed" } };
}

/** True iff `s` contains an unpaired UTF-16 surrogate — never producible by
 * reading a real file (decoding always yields well-formed text), so this
 * only catches a malformed request body. `String.prototype.isWellFormed`
 * would say this directly, but this codebase's `lib` target predates it;
 * `encodeURIComponent` already throws on the same condition. */
function hasLoneSurrogate(s: string): boolean {
  try {
    encodeURIComponent(s);
    return false;
  } catch {
    return true;
  }
}

/**
 * Pure decision + IO for PUT /api/fs/file: overwrite one existing worktree
 * file. Never creates a new file (v1 scope). Writes via a same-directory
 * temp file + rename so a process death mid-write never leaves a
 * truncated file at `path` — a broken hardlink to the old inode is an
 * accepted side effect, as is a leftover `.<name>.<uuid>.tmp` if the
 * process is killed between the temp write and the rename (nothing sweeps
 * these up on startup).
 */
export async function writeWorktreeFile(
  root: string,
  path: string,
  contents: string,
  baseHash: string,
): Promise<WriteWorktreeFileResult> {
  if (hasLoneSurrogate(contents)) {
    return { status: 400, body: { error: "invalid-contents" } };
  }

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
    try {
      const currentBuf = await fsReadFile(resolved.real);
      const reason = await readOnlyReason(root, path, resolved.real, currentBuf);
      if (reason !== null) {
        return { status: 422, body: { error: "read-only", reason } };
      }

      const currentHash = gitBlobHash(currentBuf);
      if (currentHash !== baseHash) {
        return { status: 409, body: { error: "conflict", hash: currentHash } };
      }

      const beforeStat = await stat(resolved.real);
      const mode = beforeStat.mode & 0o777;
      const tmpPath = `${dirname(resolved.real)}/.${basename(resolved.real)}.${Bun.randomUUIDv7()}.tmp`;
      try {
        await writeFile(tmpPath, nextBuf);
        await chmod(tmpPath, mode);

        // The lock above only serializes writers inside THIS process — an
        // external process (another herdr-web instance, an agent, a plain
        // editor) can still write `resolved.real` in the window between the
        // hash check above and the rename below. Re-stat right before the
        // swap and bail into a 409 on any change, to shrink that window to
        // the few milliseconds around the rename instead of the whole
        // read+hash+write span.
        const justBefore = await stat(resolved.real);
        if (
          justBefore.mtimeMs !== beforeStat.mtimeMs ||
          justBefore.size !== beforeStat.size ||
          justBefore.ino !== beforeStat.ino
        ) {
          await unlink(tmpPath).catch(() => {});
          const freshBuf = await fsReadFile(resolved.real).catch(() => currentBuf);
          return { status: 409, body: { error: "conflict", hash: gitBlobHash(freshBuf) } };
        }

        await rename(tmpPath, resolved.real);
      } catch (err) {
        await unlink(tmpPath).catch(() => {});
        throw err;
      }

      return { status: 200, body: { hash: gitBlobHash(nextBuf), size: nextBuf.byteLength } };
    } catch (err) {
      return classifyWriteError(err);
    }
  });
}
