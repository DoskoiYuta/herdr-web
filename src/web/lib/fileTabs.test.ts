import assert from "node:assert/strict";
import { test } from "vitest";
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  openTab,
  setActiveTab,
  validateFileTabsMap,
  type FileTabsState,
} from "./fileTabs.ts";

test("openTab: appends a new path to the end and activates it", () => {
  const state: FileTabsState = { paths: ["a.ts", "b.ts"], active: "a.ts" };
  assert.deepEqual(openTab(state, "c.ts"), { paths: ["a.ts", "b.ts", "c.ts"], active: "c.ts" });
});

test("openTab: clicking an already-open path activates it without adding a duplicate", () => {
  const state: FileTabsState = { paths: ["a.ts", "b.ts"], active: "a.ts" };
  assert.deepEqual(openTab(state, "b.ts"), { paths: ["a.ts", "b.ts"], active: "b.ts" });
});

test.each([
  {
    name: "closing the active tab selects its right neighbor",
    state: { paths: ["a.ts", "b.ts", "c.ts"], active: "b.ts" },
    close: "b.ts",
    want: { paths: ["a.ts", "c.ts"], active: "c.ts" },
  },
  {
    name: "closing the active last tab falls back to its left neighbor",
    state: { paths: ["a.ts", "b.ts", "c.ts"], active: "c.ts" },
    close: "c.ts",
    want: { paths: ["a.ts", "b.ts"], active: "b.ts" },
  },
  {
    name: "closing the only tab clears active (no tab selected)",
    state: { paths: ["a.ts"], active: "a.ts" },
    close: "a.ts",
    want: { paths: [], active: null },
  },
  {
    name: "closing an inactive tab leaves the active one untouched",
    state: { paths: ["a.ts", "b.ts"], active: "a.ts" },
    close: "b.ts",
    want: { paths: ["a.ts"], active: "a.ts" },
  },
])("closeTab: $name", ({ state, close, want }) => {
  assert.deepEqual(closeTab(state, close), want);
});

test("closeOtherTabs: keeps only the given path and activates it", () => {
  const state: FileTabsState = { paths: ["a.ts", "b.ts", "c.ts"], active: "a.ts" };
  assert.deepEqual(closeOtherTabs(state, "b.ts"), { paths: ["b.ts"], active: "b.ts" });
});

test("closeAllTabs: clears the tab list and active path", () => {
  assert.deepEqual(closeAllTabs(), { paths: [], active: null });
});

test("setActiveTab: ignores a path that isn't in the open tab list", () => {
  const state: FileTabsState = { paths: ["a.ts"], active: "a.ts" };
  assert.deepEqual(setActiveTab(state, "missing.ts"), state);
});

test("validateFileTabsMap: a corrupted per-repo entry falls back field-by-field", () => {
  const out = validateFileTabsMap({
    repoA: { paths: ["a.ts", "b.ts"], active: "a.ts" },
    // active not among paths -> dropped rather than trusted blindly
    repoB: { paths: ["a.ts"], active: "not-open.ts" },
    // paths isn't an array -> falls back to empty rather than throwing
    repoC: { paths: "a.ts", active: null },
    repoD: "not an object",
  });
  assert.deepEqual(out.repoA, { paths: ["a.ts", "b.ts"], active: "a.ts" });
  assert.deepEqual(out.repoB, { paths: ["a.ts"], active: null });
  assert.deepEqual(out.repoC, { paths: [], active: null });
  assert.deepEqual(out.repoD, { paths: [], active: null });
});

test("validateFileTabsMap: keeps each repoKey's tab list separate", () => {
  const out = validateFileTabsMap({
    "/repo/a": { paths: ["x.ts"], active: "x.ts" },
    "/repo/b": { paths: ["y.ts"], active: "y.ts" },
  });
  assert.deepEqual(out["/repo/a"], { paths: ["x.ts"], active: "x.ts" });
  assert.deepEqual(out["/repo/b"], { paths: ["y.ts"], active: "y.ts" });
});

test("validateFileTabsMap: returns an empty map for non-object input", () => {
  assert.deepEqual(validateFileTabsMap(null), {});
  assert.deepEqual(validateFileTabsMap("nope"), {});
});
