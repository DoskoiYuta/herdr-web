import type { TreeEntryStatus, TreeStatusEntry } from "../../contract/git";
import { runGit } from "./run";

/**
 * Maps a `git status --porcelain=v1` XY code pair to the contract's status
 * enum. Deletion (either side) and untracked/added take priority over a
 * plain "modified" reading of the same code so e.g. `AD` (added in index,
 * deleted in worktree) still surfaces as `deleted`.
 */
function mapStatus(x: string, y: string): TreeEntryStatus | null {
  if (x === "?" && y === "?") return "untracked";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A") return "added";
  if (x === " " && y === " ") return null;
  return "modified";
}

/** Worktree status vs HEAD/index for paths that differ, from `git status --porcelain`. */
export async function listStatus(root: string): Promise<TreeStatusEntry[]> {
  const { stdout } = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
  });
  const fields = stdout.split("\0").filter((s) => s.length > 0);
  const entries: TreeStatusEntry[] = [];
  let i = 0;
  while (i < fields.length) {
    const record = fields[i];
    i++;
    if (!record || record.length < 3) continue;
    const x = record[0] ?? "";
    const y = record[1] ?? "";
    const path = record.slice(3);
    // R/C records carry the old path as a second NUL-terminated field.
    if (x === "R" || x === "C") {
      i++;
    }
    const status = mapStatus(x, y);
    if (status) entries.push({ path, status });
  }
  return entries;
}
