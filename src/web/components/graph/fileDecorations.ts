// Pure helpers turning a commit's flat CommitFile[] into PathTree's
// gitStatus/decorations props. No DOM — testable with plain vitest.

import type { CommitFile, FileStatus } from "@contract/git";
import type { GitStatus } from "@pierre/trees";
import type { PathTreeDecoration } from "@/components/tree/PathTree";
import {
  ADDITIONS_COLOR,
  DELETIONS_COLOR,
  joinDecorationParts,
} from "@/components/tree/decorationColors";
import { gitStatusLetter, gitStatusLetterColor } from "@/components/tree/gitStatusDecoration";

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
  const gitStatus = toGitStatus(file.status);
  const letter = gitStatusLetter(gitStatus);
  const letterPart = letter ? [{ text: letter, color: gitStatusLetterColor(gitStatus) }] : [];
  if (file.additions === null || file.deletions === null) {
    const parts = joinDecorationParts([{ text: "bin" }, ...letterPart]);
    return { text: parts.map((p) => p.text).join(""), parts };
  }
  const statsParts: { text: string; color?: string }[] = [];
  if (file.additions > 0) statsParts.push({ text: `+${file.additions}`, color: ADDITIONS_COLOR });
  if (file.deletions > 0) statsParts.push({ text: `−${file.deletions}`, color: DELETIONS_COLOR });
  const parts = joinDecorationParts([...statsParts, ...letterPart]);
  return { text: parts.map((p) => p.text).join(""), parts };
}

export function buildDecorations(files: readonly CommitFile[]): Map<string, PathTreeDecoration> {
  const map = new Map<string, PathTreeDecoration>();
  for (const f of files) map.set(f.path, fileDecoration(f));
  return map;
}
