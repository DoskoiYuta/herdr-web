import assert from "node:assert/strict";
import { test } from "vitest";
import { fontMetrics } from "./codeFont.ts";

test("fontMetrics: computes lineHeight as 1.5x fontSize, rounded, plus diffHeaderHeight = lineHeight + 24", () => {
  // diffHeaderHeight = lineHeight + 24 mirrors @pierre/diffs' own default:
  // lineHeight 20 / diffHeaderHeight 44 (see
  // node_modules/@pierre/diffs/dist/constants.js DEFAULT_VIRTUAL_FILE_METRICS),
  // and its header min-height of `1lh + gap*3` with the library's default
  // 8px gap (8*3 = 24).
  assert.deepEqual(fontMetrics(15), { fontSize: 15, lineHeight: 23, diffHeaderHeight: 47 });
  assert.deepEqual(fontMetrics(14), { fontSize: 14, lineHeight: 21, diffHeaderHeight: 45 });
  assert.deepEqual(fontMetrics(13), { fontSize: 13, lineHeight: 20, diffHeaderHeight: 44 });
});

test("fontMetrics: clamps size to 10..24", () => {
  assert.equal(fontMetrics(5).fontSize, 10);
  assert.equal(fontMetrics(100).fontSize, 24);
  assert.equal(fontMetrics(10).fontSize, 10);
  assert.equal(fontMetrics(24).fontSize, 24);
});
