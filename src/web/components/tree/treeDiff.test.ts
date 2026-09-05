import { describe, expect, test } from "vitest";
import { diffPaths } from "./treeDiff";

describe("diffPaths", () => {
  test("reports newly-added paths", () => {
    expect(diffPaths(["a.ts"], ["a.ts", "b.ts"])).toEqual({ added: ["b.ts"], removed: [] });
  });

  test("reports removed paths", () => {
    expect(diffPaths(["a.ts", "b.ts"], ["a.ts"])).toEqual({ added: [], removed: ["b.ts"] });
  });

  test("reports both added and removed paths in one call", () => {
    expect(diffPaths(["a.ts", "b.ts"], ["b.ts", "c.ts"])).toEqual({
      added: ["c.ts"],
      removed: ["a.ts"],
    });
  });

  test("reports nothing when the path list is unchanged", () => {
    expect(diffPaths(["a.ts"], ["a.ts"])).toEqual({ added: [], removed: [] });
  });
});
