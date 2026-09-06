import { sep } from "node:path";

/** True when `path` is `root` itself or a descendant of it. A sibling that
 * merely shares `root` as a string prefix (e.g. `root + "-other"`) must not
 * match, hence the `sep`-joined comparison rather than `startsWith(root)`. */
function pathUnderRoot(path: string, root: string): boolean {
  const base = root.length > 1 ? root.replace(/[/\\]+$/, "") : root;
  return path === base || path.startsWith(base + sep);
}

/** `path` under any of `roots`. Callers pass both a root's raw form and its
 * `realpath` (resolved once, at the route boundary) because the paths
 * compared against come from two different sources: `lsof`'s cwd is a
 * physical path (realpath), while docker compose's `working_dir` label is
 * the logical path (`$PWD`) the container was started from — a symlinked
 * root only matches one of them. */
export function pathUnderAnyRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => pathUnderRoot(path, root));
}
