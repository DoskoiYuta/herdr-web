import { GEOM } from "./layout/path";

export interface EstimateRowHeightInput {
  isExpanded: boolean;
  /** Changed-file count from the expanded row's `useCommit` query; `undefined`
   * while that query hasn't resolved yet. */
  fileCount: number | undefined;
}

/**
 * react-virtual's `estimateSize` for a Graph row. Collapsed rows are always
 * `GEOM.rowHeight` (24px, `GraphView.test.tsx`'s existing assumption). An
 * expanded row is estimated as the meta line plus one 24px tree row per
 * changed file, once the file count is known — `measureElement` corrects the
 * estimate afterwards regardless, this only narrows the jump in scroll
 * position at the moment a row expands or collapses.
 */
export function estimateRowHeight({ isExpanded, fileCount }: EstimateRowHeightInput): number {
  if (!isExpanded || fileCount === undefined) return GEOM.rowHeight;
  return GEOM.rowHeight + GEOM.rowHeight * fileCount;
}
