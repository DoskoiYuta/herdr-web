import { describe, expect, test } from "bun:test";
import { buildAnchor, locateAnchor } from "./anchor";

const FILE = [
  "function greet(name) {",
  "  const greeting = `hi ${name}`;",
  "  console.log(greeting);",
  "  return greeting;",
  "}",
  "",
  "greet('world');",
];

describe("buildAnchor", () => {
  test("captures up to 3 lines of context on each side", () => {
    const anchor = buildAnchor(FILE, 2, "new"); // "  console.log(greeting);"
    expect(anchor.line).toBe("  console.log(greeting);");
    expect(anchor.side).toBe("new");
    expect(anchor.before).toEqual(FILE.slice(0, 2));
    expect(anchor.after).toEqual(FILE.slice(3, 6));
  });

  test("trims trailing whitespace and normalizes lineHint", () => {
    const lines = ["a", "b  ", "c\t"];
    const anchor = buildAnchor(lines, 1, "old");
    expect(anchor.line).toBe("b");
    expect(anchor.lineHint).toBe(2);
    expect(anchor.before).toEqual(["a"]);
    expect(anchor.after).toEqual(["c"]);
  });

  test("clamps context at file boundaries", () => {
    const anchor = buildAnchor(FILE, 0, "new");
    expect(anchor.before).toEqual([]);
    expect(anchor.after).toEqual(FILE.slice(1, 4));
  });

  test("produces a stable sha1 hash", () => {
    const a1 = buildAnchor(FILE, 2, "new");
    const a2 = buildAnchor(FILE, 2, "new");
    expect(a1.hash).toBe(a2.hash);
    expect(a1.hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("locateAnchor", () => {
  test("locates exactly on the same lines it was built from", () => {
    const anchor = buildAnchor(FILE, 2, "new");
    const loc = locateAnchor(anchor, FILE);
    expect(loc).toEqual({ line: 3, confidence: "exact" });
  });

  test("still locates via context when unrelated lines are inserted far above", () => {
    const anchor = buildAnchor(FILE, 4, "new"); // "}"
    const withInsertedLines = ["// header comment", "// another one", ...FILE];
    const loc = locateAnchor(anchor, withInsertedLines);
    expect(loc).toEqual({ line: 7, confidence: "exact" });
  });

  test("falls back to context confidence when only one side still matches", () => {
    const anchor = buildAnchor(FILE, 3, "new"); // "  return greeting;" with before=[console.log line] after=["}"]
    const mutated = [...FILE];
    // insert a line right before the target, breaking the "before" context but keeping "after"
    mutated.splice(3, 0, "  // inserted comment");
    const loc = locateAnchor(anchor, mutated);
    expect(loc?.confidence).toBe("context");
    expect(loc?.line).toBe(5); // "  return greeting;" now at index 4 (0-based) -> line 5
  });

  test("falls back to bare line match, picking the occurrence nearest the hint", () => {
    const lines = ["x", "dup", "y", "z", "dup", "w"];
    const anchor = buildAnchor(lines, 1, "new"); // "dup" at line 2, before=["x"], after=["y"]
    const mutated = ["dup", "p", "q", "dup", "r", "s"]; // both context sides differ now
    const loc = locateAnchor(anchor, mutated);
    expect(loc?.confidence).toBe("line");
    // hint is line 2; occurrences are at line 1 and line 4 -> nearest is line 1
    expect(loc?.line).toBe(1);
  });

  test("returns null when the line itself is gone", () => {
    const anchor = buildAnchor(FILE, 2, "new");
    const withoutLine = FILE.filter((l) => !l.includes("console.log"));
    expect(locateAnchor(anchor, withoutLine)).toBeNull();
  });

  test("chooses the exact/context match nearest the hint among duplicates", () => {
    const lines = ["a", "b", "c"];
    const anchor = buildAnchor(lines, 1, "new"); // "b" before=["a"] after=["c"], hint=2
    const dup = ["z", "a", "b", "c", "y", "a", "b", "c"]; // exact matches at line 3 and line 7
    const loc = locateAnchor(anchor, dup);
    expect(loc?.confidence).toBe("exact");
    expect(loc?.line).toBe(3);
  });
});
