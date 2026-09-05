import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { LsEntry, LsErrorCode, LsResponse } from "../../contract/fs";
import { resolveInsideRoot } from "./resolveInsideRoot";

export type ListDirStatus = 200 | 400 | 404;

export interface ListDirResult {
  status: ListDirStatus;
  body: LsResponse | { error: LsErrorCode };
}

function isInvalidDir(dir: string): boolean {
  if (dir.includes("\0") || isAbsolute(dir)) return true;
  return dir.split("/").includes("..");
}

/**
 * Pure decision + IO for GET /api/git/ls: a plain, git-agnostic `readdir`
 * of one directory inside the worktree, non-recursive. `dir === ""` lists
 * the worktree root. Symlinks are reported (`kind: "symlink"`) but never
 * followed, so a symlink loop or an escape outside the repo can't make the
 * server traverse into it.
 */
export async function listDir(root: string, dir: string): Promise<ListDirResult> {
  if (isInvalidDir(dir)) {
    return { status: 400, body: { error: "invalid-path" } };
  }

  const abs = dir === "" ? root : join(root, dir);
  const inside = await resolveInsideRoot(root, abs);
  if (!inside.ok) {
    return {
      status: inside.error === "not-found" ? 404 : 400,
      body: { error: inside.error },
    };
  }

  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await readdir(inside.real, { withFileTypes: true });
  } catch {
    return { status: 400, body: { error: "not-a-directory" } };
  }

  const entries: LsEntry[] = dirents
    .map((d): LsEntry => {
      const kind = d.isSymbolicLink()
        ? "symlink"
        : d.isDirectory()
          ? "dir"
          : d.isFile()
            ? "file"
            : "other";
      return { name: d.name, kind };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { status: 200, body: { entries } };
}
