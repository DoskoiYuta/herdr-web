// Pure helpers for the left file-tree sidebar (plan §5 "ファイルツリー"). No
// DOM — keep these testable with plain vitest (no jsdom needed).

import type { FileDiffMetadata } from "@pierre/diffs";
import type { GitStatus } from "@pierre/trees";
import type { PathTreeDecoration } from "@/components/tree/PathTree";
import {
  ADDITIONS_COLOR,
  DELETIONS_COLOR,
  joinDecorationParts,
  type DecorationPart,
} from "@/components/tree/decorationColors";
import { gitStatusLetter, gitStatusLetterColor } from "@/components/tree/gitStatusDecoration";
import { compareNatural } from "@/components/tree/naturalSort";
import { hunkStats } from "./reconcile.ts";

export type FileStatus = "A" | "M" | "D" | "R" | "U";

const STATUS_TO_GIT_STATUS: Record<FileStatus, GitStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  U: "untracked",
};

/** Maps this module's single-letter status to PathTree's `gitStatus` vocabulary. */
export function toGitStatus(status: FileStatus): GitStatus {
  return STATUS_TO_GIT_STATUS[status];
}

function statsParts(stats: FileStats): DecorationPart[] {
  const parts: DecorationPart[] = [];
  if (stats.additions > 0) parts.push({ text: `+${stats.additions}`, color: ADDITIONS_COLOR });
  if (stats.deletions > 0) parts.push({ text: `−${stats.deletions}`, color: DELETIONS_COLOR });
  return parts;
}

/** Builds a PathTree row decoration ("+n −m") from a file's hunk stats. */
export function statsDecoration(stats: FileStats): PathTreeDecoration {
  const parts = joinDecorationParts(statsParts(stats));
  return { text: parts.map((p) => p.text).join(""), parts };
}

/** Builds a PathTree row decoration combining "+n −m" (from a file's hunk
 * stats) with the trailing colored status letter (kept even when a file has
 * no stats, e.g. a pure rename, so the status is never silently dropped). */
export function fileDecoration(status: FileStatus, stats: FileStats): PathTreeDecoration {
  const gitStatus = toGitStatus(status);
  const letter = gitStatusLetter(gitStatus);
  const parts = joinDecorationParts([
    ...statsParts(stats),
    ...(letter ? [{ text: letter, color: gitStatusLetterColor(gitStatus) }] : []),
  ]);
  return { text: parts.map((p) => p.text).join(""), parts };
}

/**
 * Derive the single-letter status shown in the tree row. An untracked file
 * is always `U`, regardless of its parsed diff type (untracked files never
 * come from git's diff machinery, so their `type` is meaningless here).
 */
export function fileStatus(fileDiff: FileDiffMetadata, untracked: boolean): FileStatus {
  if (untracked) return "U";
  switch (fileDiff.type) {
    case "new":
      return "A";
    case "deleted":
      return "D";
    case "rename-pure":
    case "rename-changed":
      return "R";
    case "change":
    default:
      return "M";
  }
}

export interface FileStats {
  additions: number;
  deletions: number;
}

/**
 * Sum additionLines/deletionLines across a file's hunks. Reuses
 * reconcile.ts's `hunkStats()` — do not duplicate the additionLines vs.
 * additionCount distinction (plan §6.1) here.
 */
export function fileStats(fileDiff: FileDiffMetadata): FileStats {
  return hunkStats(fileDiff);
}

export interface TreeEntry {
  id: string;
  name: string;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export type TreeNode =
  | { kind: "dir"; label: string; path: string; children: TreeNode[] }
  | {
      kind: "file";
      label: string;
      path: string;
      id: string;
      status: FileStatus;
      additions: number;
      deletions: number;
    };

interface DirBuild {
  dirs: Map<string, DirBuild>;
  files: TreeEntry[];
}

function newDirBuild(): DirBuild {
  return { dirs: new Map(), files: [] };
}

// Matches PathTree's (the left-hand @pierre/trees list's) own row order —
// see naturalSort.ts — rather than a naive case-sensitive `<`, so the right
// pane's order (via order.ts, driven by this same buildTree) doesn't
// disagree with what's clicked on the left.
function byLabel<T extends { label: string }>(a: T, b: T): number {
  return compareNatural(a.label, b.label);
}

/**
 * Build a nested file tree from a flat list of files. Directories nest by
 * `/`; a chain of directories that each have exactly one child directory and
 * no files of their own is compacted into a single node (e.g.
 * `apps/docs/app`). Sort order: directories first, then files, both
 * alphabetical.
 */
export function buildTree(entries: TreeEntry[]): TreeNode[] {
  const root = newDirBuild();
  for (const entry of entries) {
    const parts = entry.name.split("/");
    parts.pop(); // strip the filename, leaving just its directory chain
    let cur = root;
    for (const part of parts) {
      let next = cur.dirs.get(part);
      if (!next) {
        next = newDirBuild();
        cur.dirs.set(part, next);
      }
      cur = next;
    }
    cur.files.push({
      id: entry.id,
      name: entry.name,
      status: entry.status,
      additions: entry.additions,
      deletions: entry.deletions,
    });
  }
  return convert(root, "");
}

function convert(dir: DirBuild, parentPath: string): TreeNode[] {
  const dirNodes: Array<{ kind: "dir"; label: string; path: string; children: TreeNode[] }> = [];

  for (const [name, child] of dir.dirs) {
    let label = name;
    let path = parentPath ? `${parentPath}/${name}` : name;
    let node = child;
    // Compact through any directory in the chain that has no files of its
    // own and exactly one subdirectory.
    while (node.files.length === 0 && node.dirs.size === 1) {
      const [onlyName, onlyChild] = node.dirs.entries().next().value as [string, DirBuild];
      label = `${label}/${onlyName}`;
      path = `${path}/${onlyName}`;
      node = onlyChild;
    }
    dirNodes.push({ kind: "dir", label, path, children: convert(node, path) });
  }
  dirNodes.sort(byLabel);

  const fileNodes = dir.files
    .map((f) => ({
      kind: "file" as const,
      label: f.name.split("/").pop() as string,
      path: f.name,
      id: f.id,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }))
    .sort(byLabel);

  return [...dirNodes, ...fileNodes];
}
