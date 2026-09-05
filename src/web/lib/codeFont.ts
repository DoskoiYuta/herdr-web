// Font-size -> @pierre/diffs metrics helper, shared by DiffView (diff/split
// view) and CodeFileView (single-file view) so both use the same row-height
// math. Moved out of diff/reconcile.ts so a non-diff viewer can use it
// without importing diff-only code.

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;

// diffHeaderHeight = lineHeight + 24. This mirrors @pierre/diffs' own
// DEFAULT_VIRTUAL_FILE_METRICS (lineHeight: 20, diffHeaderHeight: 44 — see
// node_modules/@pierre/diffs/dist/constants.js) and its header's CSS
// min-height of `1lh + gap*3` (gap defaults to 8px, so 8*3 = 24). If this
// drifts from the real rendered header height, CodeView's/File's item-height
// estimate is wrong and scrolling jumps (plan §6.3) — same failure mode as
// lineHeight itself, just for the header row instead of a code line.
const DIFF_HEADER_HEIGHT_EXTRA = 24;

export interface FontMetrics {
  fontSize: number;
  lineHeight: number;
  diffHeaderHeight: number;
}

/**
 * Derive the CodeView/File itemMetrics (lineHeight, diffHeaderHeight) / CSS
 * custom property pair from a font size, clamped to a sane range. Keeping
 * these in sync is required — see plan §6.3 — otherwise virtualization math
 * drifts from the actual rendered row height and scrolling jumps.
 */
export function fontMetrics(size: number): FontMetrics {
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  const lineHeight = Math.round(clamped * 1.5);
  return { fontSize: clamped, lineHeight, diffHeaderHeight: lineHeight + DIFF_HEADER_HEIGHT_EXTRA };
}
