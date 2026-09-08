import { describe, expect, test } from "vitest";
import { GEOM } from "./layout/path";
import { estimateRowHeight } from "./estimateRowHeight";

// 無いと壊れる: 展開直後にファイル数を無視して常に24pxのまま見積もると、
// react-virtual のスクロール位置が展開・折りたたみのたびに大きく飛ぶ。
describe("estimateRowHeight", () => {
  test.each([
    [{ isExpanded: false, fileCount: 10 }, GEOM.rowHeight],
    [{ isExpanded: true, fileCount: undefined }, GEOM.rowHeight],
    [{ isExpanded: true, fileCount: 0 }, GEOM.rowHeight],
    [{ isExpanded: true, fileCount: 400 }, GEOM.rowHeight + GEOM.rowHeight * 400],
  ] as const)("estimateRowHeight(%o) === %i", (input, expected) => {
    expect(estimateRowHeight(input)).toBe(expected);
  });
});
