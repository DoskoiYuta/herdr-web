import { parsePatchFiles } from "@pierre/diffs";
import { expect, test } from "vitest";
import { indexToLineNumber, lineNumberToIndex, sideLines } from "./sideLines.ts";

const PATCH = `diff --git a/a.txt b/a.txt
index e69de29..d95f3ad 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2-changed
+line2b
 line3
`;

function parseFile() {
  const parsed = parsePatchFiles(PATCH, "h1");
  return parsed[0]!.files[0]!;
}

test("sideLines strips trailing newlines from each line", () => {
  const file = parseFile();
  expect(sideLines(file)).toEqual({
    old: ["line1", "line2", "line3"],
    new: ["line1", "line2-changed", "line2b", "line3"],
  });
});

test("lineNumberToIndex maps real per-side line numbers to sideLines indices", () => {
  const file = parseFile();
  expect(lineNumberToIndex(file, "old", 1)).toBe(0);
  expect(lineNumberToIndex(file, "old", 3)).toBe(2);
  expect(lineNumberToIndex(file, "new", 1)).toBe(0);
  expect(lineNumberToIndex(file, "new", 4)).toBe(3);
  expect(lineNumberToIndex(file, "old", 99)).toBeNull();
});

test("indexToLineNumber is the inverse of lineNumberToIndex", () => {
  const file = parseFile();
  for (const side of ["old", "new"] as const) {
    const lines = sideLines(file)[side];
    for (let i = 0; i < lines.length; i++) {
      const lineNumber = indexToLineNumber(file, side, i);
      expect(lineNumber).not.toBeNull();
      expect(lineNumberToIndex(file, side, lineNumber!)).toBe(i);
    }
  }
});
