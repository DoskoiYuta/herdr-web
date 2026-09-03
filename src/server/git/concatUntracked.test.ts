import { describe, expect, test } from "bun:test";
import { concatUntracked } from "./concatUntracked";

describe("concatUntracked", () => {
  test("appends pieces to a base patch, adding a newline separator if needed", () => {
    const result = concatUntracked("diff --git a b\n", ["diff --git c d\n"]);
    expect(result.patch).toBe("diff --git a b\ndiff --git c d\n");
    expect(result.untrackedCount).toBe(1);
    expect(result.untrackedTruncated).toBe(false);
  });

  test("does not add an extra newline when base already ends with one", () => {
    const result = concatUntracked("base\n", ["piece\n"]);
    expect(result.patch).toBe("base\npiece\n");
  });

  test("truncates included pieces at limit but reports full count", () => {
    const pieces = ["a\n", "b\n", "c\n"];
    const result = concatUntracked("", pieces, 2);
    expect(result.patch).toBe("a\nb\n");
    expect(result.untrackedCount).toBe(3);
    expect(result.untrackedTruncated).toBe(true);
  });

  test("empty base and empty pieces yields empty patch", () => {
    const result = concatUntracked("", [], 200);
    expect(result.patch).toBe("");
    expect(result.untrackedTruncated).toBe(false);
  });
});
