// Shapes the review composer (F3-6) and inline review annotations use with
// @pierre/diffs' DiffLineAnnotation<T> mechanism. Kept separate from
// DiffPanel.tsx so it's testable without React.
import type { ForDiffMatch } from "@/lib/api";
import type { AnnotationSide, DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { Side } from "@contract/review";
import { indexToLineNumber } from "./sideLines.ts";

export type ReviewAnnotationMeta =
  | { kind: "composer"; side: Side }
  | {
      kind: "reviews";
      side: Side;
      matches: ForDiffMatch[];
      /** review id -> real line range spanned, for the `L<start>–L<end>` label. */
      ranges: Record<string, { start: number; end: number }>;
    };

/** Real (1-based) per-side line numbers a `ForDiffMatch`'s range spans, for
 * `ReviewThreadCard`'s `L<start>–L<end>` label. `start` falls back to `end`
 * when the range's start line doesn't map to a rendered line (only the end
 * line is guaranteed to, since that's where the annotation itself anchors). */
export function matchLineRange(
  fileDiff: FileDiffMetadata,
  match: ForDiffMatch,
): { start: number; end: number } {
  const side = match.review.anchor.side;
  const end = indexToLineNumber(fileDiff, side, match.line - 1 + match.span - 1);
  const start = indexToLineNumber(fileDiff, side, match.line - 1);
  return { start: start ?? end ?? 0, end: end ?? start ?? 0 };
}

export function toAnnotationSide(side: Side): AnnotationSide {
  return side === "old" ? "deletions" : "additions";
}

export function fromAnnotationSide(side: AnnotationSide): Side {
  return side === "deletions" ? "old" : "new";
}

/**
 * Groups `forDiff` matches by (side, real line number) and, when a composer
 * is open on this file, adds a composer annotation at its line — building
 * the `annotations` array a `CodeViewDiffItem<ReviewAnnotationMeta>` needs.
 *
 * `match.line` is a 1-based index into the `sideLines(fileDiff)[side]` array
 * (see sideLines.ts) sent to `POST /api/review/for-diff`, not a real
 * per-side file line number — convert it via `indexToLineNumber` before
 * addressing a `DiffLineAnnotation`, which CodeView positions by real line
 * number. Matches that no longer map to a rendered line (e.g. `line` fell
 * outside every hunk) are dropped.
 */
export function buildAnnotations(
  fileDiff: FileDiffMetadata,
  matches: ForDiffMatch[],
  composer: { side: Side; lineNumber: number } | null,
): DiffLineAnnotation<ReviewAnnotationMeta>[] {
  const byKey = new Map<string, { side: Side; lineNumber: number; matches: ForDiffMatch[] }>();
  for (const match of matches) {
    const side = match.review.anchor.side;
    // Placed at the range's END line — falls back to the start line when
    // the end doesn't map to a rendered line (e.g. a stale span reaching
    // past the file's current length after edits elsewhere in the diff).
    const endLineNumber = indexToLineNumber(fileDiff, side, match.line - 1 + match.span - 1);
    const lineNumber = endLineNumber ?? indexToLineNumber(fileDiff, side, match.line - 1);
    if (lineNumber === null) continue;
    const key = `${side}:${lineNumber}`;
    const existing = byKey.get(key);
    if (existing) existing.matches.push(match);
    else byKey.set(key, { side, lineNumber, matches: [match] });
  }

  const annotations: DiffLineAnnotation<ReviewAnnotationMeta>[] = [];
  for (const { side, lineNumber, matches: list } of byKey.values()) {
    const ranges: Record<string, { start: number; end: number }> = {};
    for (const match of list) ranges[match.review.id] = matchLineRange(fileDiff, match);
    annotations.push({
      side: toAnnotationSide(side),
      lineNumber,
      metadata: { kind: "reviews", side, matches: list, ranges },
    });
  }

  if (composer) {
    annotations.push({
      side: toAnnotationSide(composer.side),
      lineNumber: composer.lineNumber,
      metadata: { kind: "composer", side: composer.side },
    });
  }

  return annotations;
}
