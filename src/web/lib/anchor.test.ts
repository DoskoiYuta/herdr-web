import { expect, test } from "vitest";
import { buildAnchor, normalizeLine } from "./anchor";

test("normalizeLine strips \\r and trailing spaces/tabs", () => {
  expect(normalizeLine("foo  \t\r")).toBe("foo");
  expect(normalizeLine("bar")).toBe("bar");
});

test("buildAnchor: middle line gets up to 3 lines of before/after context", async () => {
  const lines = ["one", "two", "three", "four", "five", "six", "seven"];
  const anchor = await buildAnchor(lines, 3, "new");
  expect(anchor.side).toBe("new");
  expect(anchor.line).toBe("four");
  expect(anchor.before).toEqual(["one", "two", "three"]);
  expect(anchor.after).toEqual(["five", "six", "seven"]);
  expect(anchor.lineHint).toBe(4);
  expect(anchor.hash).toMatch(/^[0-9a-f]{40}$/);
});

test("buildAnchor: first line has no before context", async () => {
  const anchor = await buildAnchor(["a", "b", "c"], 0, "old");
  expect(anchor.before).toEqual([]);
  expect(anchor.line).toBe("a");
});

test("buildAnchor: hash is stable for the same input", async () => {
  const lines = ["x", "y", "z"];
  const a = await buildAnchor(lines, 1, "new");
  const b = await buildAnchor(lines, 1, "new");
  expect(a.hash).toBe(b.hash);
});

test("buildAnchor: normalizes trailing whitespace before hashing", async () => {
  const withTrailing = await buildAnchor(["foo  ", "bar\t", "baz"], 1, "new");
  const withoutTrailing = await buildAnchor(["foo", "bar", "baz"], 1, "new");
  expect(withTrailing.hash).toBe(withoutTrailing.hash);
});
