// Shapes the ask composer and inline ask threads for CodeFileView's
// `LineAnnotation<AskAnnotationMeta>[]`. Kept separate from FilesPanel.tsx so
// it's testable without mounting @pierre/diffs — unlike the diff side
// (reviewAnnotations.ts), a file view has one side ("new") and its
// `ForFileMatch.endLine` is already a real 1-based line number, so there's no
// per-side index<->line-number mapping to do here.
import type { ForFileMatch } from "@/lib/api";
import type { LineAnnotation } from "@pierre/diffs";

export type AskAnnotationMeta = { kind: "composer" } | { kind: "asks"; matches: ForFileMatch[] };

/** Matches whose anchor no longer resolves against the file's current
 * content (`startLine`/`endLine` null) — shown in the mismatch strip instead
 * of inline. */
export function outdatedMatches(matches: ForFileMatch[]): ForFileMatch[] {
  return matches.filter((m) => m.startLine === null || m.endLine === null);
}

/** Matches that still anchor to a real line — candidates for inline annotations. */
export function anchoredMatches(matches: ForFileMatch[]): (ForFileMatch & { endLine: number })[] {
  return matches.filter((m): m is ForFileMatch & { endLine: number } => m.endLine !== null);
}

/**
 * Groups anchored matches by `endLine` and, when a composer is open on this
 * file, adds a composer annotation at `composerLine`. Annotations are placed
 * at each thread's END line (matching reviewAnnotations.ts's convention).
 */
export function buildAskAnnotations(
  matches: ForFileMatch[],
  composerLine: number | null,
): LineAnnotation<AskAnnotationMeta>[] {
  const byLine = new Map<number, ForFileMatch[]>();
  for (const match of anchoredMatches(matches)) {
    const line = match.endLine;
    const existing = byLine.get(line);
    if (existing) existing.push(match);
    else byLine.set(line, [match]);
  }

  const annotations: LineAnnotation<AskAnnotationMeta>[] = [];
  for (const [lineNumber, list] of byLine) {
    annotations.push({ lineNumber, metadata: { kind: "asks", matches: list } });
  }
  if (composerLine !== null) {
    annotations.push({ lineNumber: composerLine, metadata: { kind: "composer" } });
  }
  return annotations;
}
