import { realpath } from "node:fs/promises";
import { sep } from "node:path";

export type InsideRootError = "outside-repo" | "not-found";

/**
 * Realpath `abs` and confirm it falls within `realpath(root)` (equal, or a
 * `sep`-prefixed descendant) — the shared containment check against a
 * symlink escaping the worktree, used by both the diff file reader
 * (files.ts) and the file-viewer file reader (readFile.ts).
 */
export async function resolveInsideRoot(
  root: string,
  abs: string,
): Promise<{ ok: true; real: string } | { ok: false; error: InsideRootError }> {
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "not-found" };
    }
    return { ok: false, error: "outside-repo" };
  }

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    realRoot = root;
  }

  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return { ok: false, error: "outside-repo" };
  }
  return { ok: true, real };
}
