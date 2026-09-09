import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { test, vi } from "vitest";
import {
  getScroll,
  MAX_SCROLL_ENTRIES_PER_REPO,
  setScroll,
  useFileScroll,
  validateFileScrollMap,
  type FileScrollEntry,
} from "./fileScroll.ts";

test("setScroll/getScroll: source and preview positions for the same path are independent", () => {
  let entry: FileScrollEntry = {};
  entry = setScroll(entry, "a.md", "source", 120);
  entry = setScroll(entry, "a.md", "preview", 40);
  assert.equal(getScroll(entry, "a.md", "source"), 120);
  assert.equal(getScroll(entry, "a.md", "preview"), 40);
});

test("setScroll: past the per-repo cap, the least-recently-touched path is dropped", () => {
  let entry: FileScrollEntry = {};
  for (let i = 0; i < MAX_SCROLL_ENTRIES_PER_REPO; i++) {
    entry = setScroll(entry, `f${i}.ts`, "source", i);
  }
  // touch f1 again so it's no longer the least-recently-used
  entry = setScroll(entry, "f1.ts", "source", 999);
  entry = setScroll(entry, "new.ts", "source", 1);
  assert.equal(getScroll(entry, "f0.ts", "source"), undefined); // oldest untouched dropped
  assert.equal(getScroll(entry, "f1.ts", "source"), 999); // recently touched survives
  assert.equal(getScroll(entry, "new.ts", "source"), 1);
  assert.equal(Object.keys(entry).length, MAX_SCROLL_ENTRIES_PER_REPO);
});

test.each([
  { name: "negative numbers are rejected", raw: { "a.ts": { source: -1 } } },
  { name: "NaN is rejected", raw: { "a.ts": { source: NaN } } },
  { name: "strings are rejected", raw: { "a.ts": { source: "120" } } },
  { name: "a non-object path entry is rejected", raw: { "a.ts": "not an object" } },
])("validateFileScrollMap: $name (field dropped, not the whole map)", ({ raw }) => {
  const out = validateFileScrollMap({ repoA: raw });
  assert.equal(getScroll(out.repoA ?? {}, "a.ts", "source"), undefined);
});

test("validateFileScrollMap: keeps valid fields alongside a corrupted sibling", () => {
  const out = validateFileScrollMap({
    repoA: { "a.ts": { source: 10, preview: -1 }, "b.ts": { preview: 5 } },
  });
  assert.equal(getScroll(out.repoA ?? {}, "a.ts", "source"), 10);
  assert.equal(getScroll(out.repoA ?? {}, "a.ts", "preview"), undefined);
  assert.equal(getScroll(out.repoA ?? {}, "b.ts", "preview"), 5);
});

test("validateFileScrollMap: returns an empty map for non-object input", () => {
  assert.deepEqual(validateFileScrollMap(null), {});
  assert.deepEqual(validateFileScrollMap("nope"), {});
});

test("useFileScroll: switching to another file inside the debounce window keeps the previous file's last position", () => {
  vi.useFakeTimers();
  try {
    localStorage.clear();
    const { result } = renderHook(() => useFileScroll("repo"));
    act(() => result.current.set("a.ts", "source", 300));
    act(() => result.current.set("b.ts", "source", 10));
    act(() => vi.runAllTimers());
    assert.equal(result.current.get("a.ts", "source"), 300);
    assert.equal(result.current.get("b.ts", "source"), 10);
  } finally {
    vi.useRealTimers();
  }
});
