import { describe, expect, test } from "vitest";
import { formatElapsedSeconds, formatElapsedSince } from "./elapsed";

describe("formatElapsedSeconds", () => {
  test.each([
    [5, "5s"],
    [65, "1m5s"],
    [3661, "1h1m"],
    [90000, "1d1h"],
  ])("%i seconds -> %s", (seconds, expected) => {
    expect(formatElapsedSeconds(seconds)).toBe(expected);
  });
});

describe("formatElapsedSince", () => {
  test("computes elapsed time from a parseable ISO date", () => {
    const now = Date.parse("2026-01-01T00:01:05Z");
    expect(formatElapsedSince("2026-01-01T00:00:00Z", now)).toBe("1m5s");
  });

  test("returns null for an unparseable date (never throws)", () => {
    expect(formatElapsedSince("not-a-date")).toBeNull();
  });
});
