// Pure helpers turning a commit's flat CommitFile[] into PathTree's
// gitStatus/decorations props. No DOM — testable with plain vitest.

import type { CommitFile, FileStatus } from "@contract/git";
import type { GitStatus } from "@pierre/trees";
import type { PathTreeDecoration } from "@/components/tree/PathTree";
import { ADDITIONS_COLOR, DELETIONS_COLOR } from "@/components/tree/decorationColors";

// C(opied)/T(ype-changed)/U(nmerged) have no direct GitStatus equivalent;
// mapped to the closest existing status (added/modified/modified) rather
// than widening PathTree's status vocabulary for three rare git states.
const STATUS_TO_GIT_STATUS: Record<FileStatus, GitStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "added",
  T: "modified",
  U: "modified",
};

export function toGitStatus(status: FileStatus): GitStatus {
  return STATUS_TO_GIT_STATUS[status];
}

export function buildGitStatus(
  files: readonly CommitFile[],
): { path: string; status: GitStatus }[] {
  return files.map((f) => ({ path: f.path, status: toGitStatus(f.status) }));
}

export function fileDecoration(file: CommitFile): PathTreeDecoration {
  if (file.additions === null || file.deletions === null) {
    return { text: "bin" };
  }
  const parts: { text: string; color?: string }[] = [];
  if (file.additions > 0) parts.push({ text: `+${file.additions}`, color: ADDITIONS_COLOR });
  if (file.deletions > 0) parts.push({ text: `−${file.deletions}`, color: DELETIONS_COLOR });
  return { text: parts.map((p) => p.text).join(" "), parts };
}

export function buildDecorations(files: readonly CommitFile[]): Map<string, PathTreeDecoration> {
  const map = new Map<string, PathTreeDecoration>();
  for (const f of files) map.set(f.path, fileDecoration(f));
  return map;
}
