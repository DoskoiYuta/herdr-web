import assert from "node:assert/strict";
import { test } from "vitest";
import {
  clampTreeWidth,
  DEFAULT_VIEWER_SETTINGS,
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
  validateViewerSettings,
} from "./viewerSettings.ts";

test("validateViewerSettings: returns defaults for null/non-object input", () => {
  assert.deepEqual(validateViewerSettings(null), DEFAULT_VIEWER_SETTINGS);
  assert.deepEqual(validateViewerSettings(undefined), DEFAULT_VIEWER_SETTINGS);
  assert.deepEqual(validateViewerSettings("nope"), DEFAULT_VIEWER_SETTINGS);
});

test("validateViewerSettings: accepts each valid field", () => {
  const out = validateViewerSettings({ fontSize: 20, showTree: false, treeWidth: 300 });
  assert.deepEqual(out, { fontSize: 20, showTree: false, treeWidth: 300 });
});

test("validateViewerSettings: a bad field falls back to its own default, others unaffected", () => {
  const out = validateViewerSettings({ fontSize: 999, showTree: false });
  assert.equal(out.fontSize, DEFAULT_VIEWER_SETTINGS.fontSize);
  assert.equal(out.showTree, false);
});

test("validateViewerSettings: treeWidth is clamped via clampTreeWidth", () => {
  assert.equal(validateViewerSettings({ treeWidth: 10 }).treeWidth, MIN_TREE_WIDTH);
  assert.equal(validateViewerSettings({ treeWidth: 9999 }).treeWidth, MAX_TREE_WIDTH);
});

test("clampTreeWidth: non-finite falls back to the default", () => {
  assert.equal(clampTreeWidth(Number.NaN), DEFAULT_VIEWER_SETTINGS.treeWidth);
  assert.equal(clampTreeWidth("240"), DEFAULT_VIEWER_SETTINGS.treeWidth);
});
