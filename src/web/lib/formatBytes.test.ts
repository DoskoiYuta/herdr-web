import { describe, expect, test } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  // 無いと壊れる: Files ヘッダの size 表示が生の bytes 数のままになり、design.pen
  // の「4.2 KB」のような読みやすい単位表示にならない。
  test.each([
    [0, "0 bytes"],
    [80, "80 bytes"],
    [1023, "1023 bytes"],
    [1024, "1.0 KB"],
    [4300, "4.2 KB"],
    [1024 * 1024, "1.0 MB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
