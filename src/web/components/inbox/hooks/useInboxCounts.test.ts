import { describe, expect, test } from "vitest";
import { useInboxCounts } from "./useInboxCounts";

describe("useInboxCounts", () => {
  // 無いと壊れる: M13 の集約 API が無い間にバッジへ 0 件や undefined を渡すと、
  // 「0 件」というバッジが誤って出てしまう。
  test("returns null (no aggregation API yet, M13) so callers must not render a count", () => {
    expect(useInboxCounts().data).toBeNull();
  });
});
