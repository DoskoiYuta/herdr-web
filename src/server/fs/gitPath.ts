import { sep } from "node:path";

/**
 * True iff `real` (an already `realpath`'d absolute path) has `.git` as any
 * path segment — `.git` itself, or anything under it, is off limits to
 * filesystem-only operations (trash, write) that must not desync a worktree
 * from git's own bookkeeping.
 *
 * Checked on every segment of the full absolute real path, not just the
 * portion relative to the request's `root` — `root` itself can be pointed
 * inside (or even AT) a `.git` directory (nothing stops a client from
 * sending `root=<repo>/.git`), so a check scoped to "segments under root"
 * misses that case entirely. Also case-insensitive, since a `.GIT` spelling
 * resolves to the same directory as `.git` on the case-insensitive-but-
 * preserving filesystems most desktop OSes default to (APFS, exFAT, NTFS).
 */
export function isGitInternalPath(real: string): boolean {
  return real.split(sep).some((seg) => seg.toLowerCase() === ".git");
}
