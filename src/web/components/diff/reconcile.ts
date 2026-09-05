// Pure helpers for the tdiff client. No DOM, no fetch, no localStorage —
// keep these testable with plain vitest (no jsdom needed).

import type { CodeViewDiffItem, FileDiffMetadata } from "@pierre/diffs";

export interface FileEntry {
  hash: string | undefined;
  fileDiff: FileDiffMetadata;
  version: number;
}

export type FileMap = Map<string, FileEntry>;

/**
 * Reconcile a freshly-parsed set of file diffs against the previously
 * rendered state, preserving object identity (and thus hydration / expanded
 * state) for files whose content hash did not change.
 *
 * @param prev - name (or name#occurrence) -> previous entry
 * @param parsedFiles - FileDiffMetadata[], in display order
 * @param fileHashes - name -> content hash (from /api/patch files[])
 */
export function reconcile(
  prev: FileMap,
  parsedFiles: FileDiffMetadata[],
  fileHashes: Map<string, string>,
): { items: CodeViewDiffItem[]; next: FileMap } {
  const items: CodeViewDiffItem[] = [];
  const next: FileMap = new Map();
  const nameCounts = new Map<string, number>();

  for (const fileDiff of parsedFiles) {
    const name = fileDiff.name;
    const hash = fileHashes.get(name);

    // Defensive: a patch should never contain two files with the same name,
    // but if it somehow does, don't let their ids/map-keys collide (2nd+
    // occurrence gets its own map key and a `#2`, `#3`, ... id suffix).
    const occurrence = (nameCounts.get(name) ?? 0) + 1;
    nameCounts.set(name, occurrence);
    const mapKey = occurrence === 1 ? name : `${name}#${occurrence}`;

    const prevEntry = prev.get(mapKey);

    let entry: FileEntry;
    if (prevEntry && hash !== undefined && prevEntry.hash === hash) {
      // Unchanged: reuse the old fileDiff object (may be hydrated) and version.
      entry = { hash, fileDiff: prevEntry.fileDiff, version: prevEntry.version };
    } else {
      // New or changed: use the freshly parsed fileDiff, bump version.
      const version = (prevEntry?.version ?? 0) + 1;
      entry = { hash, fileDiff, version };
    }

    // The id itself carries the version so a content change (version bump)
    // gets a *fresh* CodeView instance instead of an in-place item swap —
    // see plan.md §5 "version を必ず上げること" and the id-collision note
    // above for the duplicate-name suffix.
    const id =
      occurrence === 1
        ? `diff:${name}#${entry.version}`
        : `diff:${name}#${entry.version}#${occurrence}`;

    next.set(mapKey, entry);
    items.push({ id, type: "diff", fileDiff: entry.fileDiff, version: entry.version });
  }

  return { items, next };
}

export interface Summary {
  files: number;
  additions: number;
  deletions: number;
}

export interface HunkStats {
  additions: number;
  deletions: number;
}

/**
 * Sum additionLines/deletionLines across all hunks of a single file. Do NOT
 * use additionCount/deletionCount — those include context lines (see plan
 * §6.1). Shared by `summarize()` below and tree.ts's `fileStats()`.
 */
export function hunkStats(file: FileDiffMetadata): HunkStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks ?? []) {
    additions += hunk.additionLines ?? 0;
    deletions += hunk.deletionLines ?? 0;
  }
  return { additions, deletions };
}

/**
 * Sum additionLines/deletionLines across all hunks of all files. Do NOT use
 * additionCount/deletionCount — those include context lines (see plan §6.1).
 */
export function summarize(parsedFiles: FileDiffMetadata[]): Summary {
  let additions = 0;
  let deletions = 0;
  for (const file of parsedFiles) {
    const stats = hunkStats(file);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { files: parsedFiles.length, additions, deletions };
}

/**
 * Below this container width a split diff is two unreadable slivers (each
 * side is half a terminal pane minus gutters), so the view renders unified
 * regardless of the setting. The setting itself is left untouched.
 */
export const NARROW_SPLIT_PX = 640;

export function effectiveDiffStyle(
  setting: "split" | "unified",
  containerWidth: number | null,
): "split" | "unified" {
  if (setting === "unified") return "unified";
  if (containerWidth !== null && containerWidth < NARROW_SPLIT_PX) return "unified";
  return "split";
}
