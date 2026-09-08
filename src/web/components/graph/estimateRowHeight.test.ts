import { describe, expect, test } from "vitest";
import { GEOM } from "./layout/path";
import { PATH_TREE_ROW_HEIGHT } from "@/components/tree/PathTree";
import { estimateRowHeight } from "./estimateRowHeight";

// 無いと壊れる: 展開直後にパスを無視して常に24pxのまま見積もると、
// react-virtual のスクロール位置が展開・折りたたみのたびに大きく飛ぶ。
// また GEOM.rowHeight(24) を tree の行高として使うと、実際の @pierre/trees
// の行高(30px)とずれて見積もりが実測と合わなくなる。
describe("estimateRowHeight", () => {
  test.each([
    [{ isExpanded: false, paths: ["a.ts", "dir/b.ts"] }, GEOM.rowHeight],
    [{ isExpanded: true, paths: undefined }, GEOM.rowHeight],
    [{ isExpanded: true, paths: [] }, GEOM.rowHeight],
    [{ isExpanded: true, paths: ["a.ts", "b.ts"] }, GEOM.rowHeight + PATH_TREE_ROW_HEIGHT * 2],
    // "dir/c.ts" adds one directory row alongside the file row.
    [{ isExpanded: true, paths: ["a.ts", "dir/c.ts"] }, GEOM.rowHeight + PATH_TREE_ROW_HEIGHT * 3],
  ] as const)("estimateRowHeight(%o) === %i", (input, expected) => {
    expect(estimateRowHeight(input)).toBe(expected);
  });
});
