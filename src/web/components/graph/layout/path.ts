import type { LayoutRow, LayoutSegment } from "./layout";

export interface Geom {
  laneWidth: number;
  rowHeight: number;
}

/** Fixed row height / lane width. No DOM measurement (must stay virtualization-friendly). */
export const GEOM: Geom = { laneWidth: 16, rowHeight: 24 };

/** Center point of a row's commit node, in row-local SVG coordinates. */
export function nodeCenter(row: LayoutRow, geom: Geom = GEOM): { cx: number; cy: number } {
  return { cx: (row.lane + 0.5) * geom.laneWidth, cy: geom.rowHeight / 2 };
}

const laneX = (lane: number, geom: Geom): number => (lane + 0.5) * geom.laneWidth;

/**
 * SVG path `d` string for one segment spanning the full height of a row:
 * a straight vertical line when the lane doesn't change, otherwise a cubic
 * bezier whose control points sit `rowHeight * 0.5` in from the top/bottom
 * edges (per plan.md §6.2/§6.4).
 */
export function segmentPath(seg: LayoutSegment, geom: Geom = GEOM): string {
  const x1 = laneX(seg.fromLane, geom);
  const x2 = laneX(seg.toLane, geom);
  const y1 = 0;
  const y2 = geom.rowHeight;

  if (seg.fromLane === seg.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const c = geom.rowHeight * 0.5;
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}`;
}
