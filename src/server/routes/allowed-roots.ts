import { realpath as realpathAsync } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";

/**
 * Shared allowed-roots check used by any route that accepts a filesystem
 * path from the client (git routes, herdr workspace routes): the path must
 * realpath under $HOME or one of `allowedRoots`. Extracted from git.ts so
 * `routes/herdr.ts` can reuse it instead of re-implementing the check.
 */
export async function isAllowedRoot(path: string, allowedRoots: string[]): Promise<boolean> {
  let realPath: string;
  try {
    realPath = await realpathAsync(path);
  } catch {
    return false;
  }
  const roots = [homedir(), ...allowedRoots];
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpathAsync(root);
    } catch {
      continue;
    }
    if (realPath === realRoot || realPath.startsWith(realRoot + sep)) return true;
  }
  return false;
}

/** True when `path` exists (via `realpath`) so a 403 can be distinguished from a plain 404. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await realpathAsync(path);
    return true;
  } catch {
    return false;
  }
}
