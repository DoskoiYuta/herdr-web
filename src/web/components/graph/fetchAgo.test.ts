import { describe, expect, test } from "vitest";
import { formatFetchAgo } from "./fetchAgo";

describe("formatFetchAgo", () => {
  test.each([
    [0, "たった今"],
    [59_000, "たった今"],
    [60_000, "1 分前"],
    [2 * 60_000, "2 分前"],
    [59 * 60_000, "59 分前"],
    [60 * 60_000, "1 時間前"],
    [3 * 60 * 60_000, "3 時間前"],
  ])("%i ms ago -> %s", (elapsedMs, expected) => {
    expect(formatFetchAgo(elapsedMs)).toBe(expected);
  });
});
