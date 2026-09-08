import type { LayoutRow, LayoutSegment } from "./layout";

export interface Geom {
  laneWidth: number;
  rowHeight: number;
}

/** Fixed row height / lane width. No DOM measurement (must stay virtualization-friendly). */
export const GEOM: Geom = { laneWidth: 16, rowHeight: 24 };

/** Gutter (lane area) width cap in px, so a highly-branched history doesn't crowd out subject/detail columns. */
export const MAX_GUTTER_PX = 160;
/** Lane width floor in px, below which lanes become illegible. */
export const MIN_LANE_PX = 4;

/**
 * Lane width and total gutter width for a row with `laneCount` lanes.
 * Shrinks `laneWidth` below `GEOM.laneWidth` once `laneCount * GEOM.laneWidth`
 * would exceed `MAX_GUTTER_PX`, down to a floor of `MIN_LANE_PX`; `width` is
 * `laneCount * laneWidth`, capped at `MAX_GUTTER_PX`.
 */
export function gutterGeom(laneCount: number): { laneWidth: number; width: number } {
  const count = Math.max(1, laneCount);
  const laneWidth = Math.min(GEOM.laneWidth, Math.max(MIN_LANE_PX, MAX_GUTTER_PX / count));
  const width = Math.min(count * laneWidth, MAX_GUTTER_PX);
  return { laneWidth, width };
}

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
