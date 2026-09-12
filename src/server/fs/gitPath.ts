import { sep } from "node:path";

/**
 * True iff `real` (an already `realpath`'d absolute path) lies at or under a
 * `.git` directory of `realRoot` (also `realpath`'d) — `.git` itself, or
 * anything under it, is off limits to filesystem-only operations (trash,
 * write) that must not desync the worktree from git's own bookkeeping.
 *
 * Checked on the symlink-resolved real path, not the caller-supplied
 * relative path, and case-insensitively: a literal `path.split("/")[0]
 * === ".git"` check on the raw input misses a `.` segment, a `.GIT` spelling
 * (the default case-insensitive-but-preserving behavior of APFS and most
 * default Windows/Linux-desktop filesystems), a symlinked directory that
 * resolves into `.git`, and a `root` pointed at a parent directory (making
 * `.git` a non-leading segment of the relative path).
 */
export function isGitInternalPath(realRoot: string, real: string): boolean {
  const rel = real === realRoot ? "" : real.slice(realRoot.length + sep.length);
  return rel.split(sep).some((seg) => seg.toLowerCase() === ".git");
}
