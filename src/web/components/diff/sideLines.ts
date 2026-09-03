// Pure helpers bridging @pierre/diffs' FileDiffMetadata (partial patch
// content, per-hunk index bookkeeping) and the review domain's line-content
// anchoring (plan.md F5-2 / F3-6).
//
// `FileDiffMetadata.deletionLines` / `.additionLines` are already exactly
// the per-side line arrays the server's `buildAnchor`/`locateAnchor`
// (src/server/review/domain/anchor.ts) expect as `lines: string[]` — when
// `isPartial` is true (patch-parsed, our case) they contain only the
// context+changed lines the patch carries, in hunk order, which is what the
// plan calls out as an acceptable approximation ("行外のコンテキストはhunkが
// 持つもの"). Anchors built and matched against this array are internally
// consistent as long as both sides of the round-trip (create-time
// `buildAnchor`, match-time `forDiff`'s `sideLines`) use the same array —
// they don't need to correspond to real git line numbers.
//
// The one place real (1-based, hunk-header) line numbers matter is the UI:
// CodeView's line selection and annotation APIs address lines by their real
// per-side line number, not by index into `deletionLines`/`additionLines`.
// These helpers convert between the two.

import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { Side } from "@contract/review";

/** @pierre/diffs keeps each line's trailing "\n" in deletionLines/additionLines; strip it. */
function stripEol(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\n$/, ""));
}

export function sideLines(fileDiff: FileDiffMetadata): { old: string[]; new: string[] } {
  return { old: stripEol(fileDiff.deletionLines), new: stripEol(fileDiff.additionLines) };
}

function hunkRange(hunk: Hunk, side: Side): { start: number; count: number; index: number } {
  return side === "old"
    ? { start: hunk.deletionStart, count: hunk.deletionCount, index: hunk.deletionLineIndex }
    : { start: hunk.additionStart, count: hunk.additionCount, index: hunk.additionLineIndex };
}

/** Real (1-based) per-side file line number -> 0-based index into `sideLines(fileDiff)[side]`. */
export function lineNumberToIndex(
  fileDiff: FileDiffMetadata,
  side: Side,
  lineNumber: number,
): number | null {
  for (const hunk of fileDiff.hunks) {
    const r = hunkRange(hunk, side);
    if (lineNumber >= r.start && lineNumber < r.start + r.count) {
      return r.index + (lineNumber - r.start);
    }
  }
  return null;
}

/** 0-based index into `sideLines(fileDiff)[side]` -> real (1-based) per-side file line number. */
export function indexToLineNumber(
  fileDiff: FileDiffMetadata,
  side: Side,
  index0: number,
): number | null {
  for (const hunk of fileDiff.hunks) {
    const r = hunkRange(hunk, side);
    if (index0 >= r.index && index0 < r.index + r.count) {
      return r.start + (index0 - r.index);
    }
  }
  return null;
}
