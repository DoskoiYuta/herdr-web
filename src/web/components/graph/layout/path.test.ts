import { describe, it, expect } from "vitest";
import { segmentPath, nodeCenter, gutterGeom, GEOM, MAX_GUTTER_PX } from "./path";
import type { LayoutRow, LayoutSegment } from "./layout";

describe("GEOM", () => {
  it("exposes laneWidth and rowHeight", () => {
    expect(GEOM.laneWidth).toBeGreaterThan(0);
    expect(GEOM.rowHeight).toBeGreaterThan(0);
  });
});

describe("nodeCenter", () => {
  it("centers on the lane column, mid-row vertically", () => {
    const row: LayoutRow = { hash: "h", lane: 0, color: 0, segments: [] };
    const geom = { laneWidth: 16, rowHeight: 24 };
    expect(nodeCenter(row, geom)).toEqual({ cx: 8, cy: 12 });
  });

  it("accounts for lane index", () => {
    const row: LayoutRow = { hash: "h", lane: 2, color: 0, segments: [] };
    const geom = { laneWidth: 16, rowHeight: 24 };
    expect(nodeCenter(row, geom)).toEqual({ cx: 40, cy: 12 });
  });

  it("uses the default GEOM when no geom is passed", () => {
    const row: LayoutRow = { hash: "h", lane: 0, color: 0, segments: [] };
    expect(nodeCenter(row)).toEqual({ cx: GEOM.laneWidth / 2, cy: GEOM.rowHeight / 2 });
  });
});

describe("gutterGeom", () => {
  // 無いと壊れる: ブランチが多いリポジトリで gutter が無制限に広がり、subject
  // 列と展開中の CommitDetail が潰れる（実機で submodule の多いリポジトリで発生）。
  it.each([
    [3, GEOM.laneWidth],
    [20, MAX_GUTTER_PX],
    [60, MAX_GUTTER_PX],
  ])("caps total width at %i lanes to <= MAX_GUTTER_PX (width=%i)", (laneCount) => {
    expect(gutterGeom(laneCount).width).toBeLessThanOrEqual(MAX_GUTTER_PX);
  });

  it("keeps the default lane width when lane count is low", () => {
    expect(gutterGeom(3).laneWidth).toBe(GEOM.laneWidth);
  });

  it("shrinks lane width once lane count would exceed the gutter cap", () => {
    expect(gutterGeom(20).laneWidth).toBeLessThan(GEOM.laneWidth);
    expect(gutterGeom(60).laneWidth).toBeLessThan(gutterGeom(20).laneWidth);
  });
});

describe("segmentPath", () => {
  const geom = { laneWidth: 16, rowHeight: 24 };

  it("renders a straight vertical line when fromLane === toLane", () => {
    const seg: LayoutSegment = { fromLane: 1, toLane: 1, color: 0, kind: "pass" };
    const x = 1.5 * geom.laneWidth;
    expect(segmentPath(seg, geom)).toBe(`M ${x} 0 L ${x} ${geom.rowHeight}`);
  });

  it("renders a full-height cubic bezier for a lane-changing pass segment, control points offset by rowHeight*0.5", () => {
    const seg: LayoutSegment = { fromLane: 0, toLane: 1, color: 0, kind: "pass" };
    const x1 = 0.5 * geom.laneWidth;
    const x2 = 1.5 * geom.laneWidth;
    const c = geom.rowHeight * 0.5;
    expect(segmentPath(seg, geom)).toBe(
      `M ${x1} 0 C ${x1} ${c}, ${x2} ${geom.rowHeight - c}, ${x2} ${geom.rowHeight}`,
    );
  });

  it("uses the default GEOM when no geom is passed", () => {
    const seg: LayoutSegment = { fromLane: 0, toLane: 0, color: 0, kind: "pass" };
    const x = 0.5 * GEOM.laneWidth;
    expect(segmentPath(seg)).toBe(`M ${x} 0 L ${x} ${GEOM.rowHeight}`);
  });

  // 無いと壊れる: merge-in / 別レーンへの to-parent が行の上端/下端をそのまま
  // 結ぶ全高カーブのままだと、実機でコミットノードの脇を素通りして見える。
  it.each([
    {
      label: "merge-in ends at the node center",
      seg: { fromLane: 2, toLane: 0, color: 0, kind: "merge-in" } satisfies LayoutSegment,
      start: { x: 2.5 * geom.laneWidth, y: 0 },
      end: { x: 0.5 * geom.laneWidth, y: geom.rowHeight / 2 },
    },
    {
      label: "to-parent to a different lane starts at the node center",
      seg: { fromLane: 0, toLane: 1, color: 0, kind: "to-parent" } satisfies LayoutSegment,
      start: { x: 0.5 * geom.laneWidth, y: geom.rowHeight / 2 },
      end: { x: 1.5 * geom.laneWidth, y: geom.rowHeight },
    },
  ])("$label", ({ seg, start, end }) => {
    const d = segmentPath(seg, geom);
    const startMatch = d.match(/^M ([\d.]+) ([\d.]+)/);
    const endMatch = d.match(/, ([\d.]+) ([\d.]+)$/);
    expect(startMatch && [Number(startMatch[1]), Number(startMatch[2])]).toEqual([
      start.x,
      start.y,
    ]);
    expect(endMatch && [Number(endMatch[1]), Number(endMatch[2])]).toEqual([end.x, end.y]);
  });
});
