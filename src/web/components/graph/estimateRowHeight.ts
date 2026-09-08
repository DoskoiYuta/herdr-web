import { GEOM } from "./layout/path";
import { countFileTreeRows, PATH_TREE_ROW_HEIGHT } from "@/components/tree/PathTree";

export interface EstimateRowHeightInput {
  isExpanded: boolean;
  /** Changed-file paths from the expanded row's `useCommit` query; `undefined`
   * while that query hasn't resolved yet. */
  paths: readonly string[] | undefined;
}

/**
 * react-virtual's `estimateSize` for a Graph row. Collapsed rows are always
 * `GEOM.rowHeight` (24px, `GraphView.test.tsx`'s existing assumption). An
 * expanded row is estimated as the meta line plus one tree row (at
 * `PATH_TREE_ROW_HEIGHT`, @pierre/trees' own row height — not `GEOM.rowHeight`,
 * which only applies to Graph's own rows) per file and ancestor directory,
 * once the path list is known — `measureElement` corrects the estimate
 * afterwards regardless, this only narrows the jump in scroll position at
 * the moment a row expands or collapses.
 */
export function estimateRowHeight({ isExpanded, paths }: EstimateRowHeightInput): number {
  if (!isExpanded || paths === undefined) return GEOM.rowHeight;
  return GEOM.rowHeight + PATH_TREE_ROW_HEIGHT * countFileTreeRows(paths);
}
