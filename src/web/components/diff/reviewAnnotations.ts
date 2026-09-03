// Shapes the review composer (F3-6) and inline review annotations use with
// @pierre/diffs' DiffLineAnnotation<T> mechanism. Kept separate from
// DiffPanel.tsx so it's testable without React.
import type { ForDiffMatch } from "@/lib/api";
import type { AnnotationSide, DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { Side } from "@contract/review";
import { indexToLineNumber } from "./sideLines.ts";

export type ReviewAnnotationMeta =
  | { kind: "composer"; side: Side }
  | { kind: "reviews"; side: Side; matches: ForDiffMatch[] };

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
    const lineNumber = indexToLineNumber(fileDiff, side, match.line - 1);
    if (lineNumber === null) continue;
    const key = `${side}:${lineNumber}`;
    const existing = byKey.get(key);
    if (existing) existing.matches.push(match);
    else byKey.set(key, { side, lineNumber, matches: [match] });
  }

  const annotations: DiffLineAnnotation<ReviewAnnotationMeta>[] = [];
  for (const { side, lineNumber, matches: list } of byKey.values()) {
    annotations.push({
      side: toAnnotationSide(side),
      lineNumber,
      metadata: { kind: "reviews", side, matches: list },
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
