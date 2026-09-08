import { test } from "vitest";
import assert from "node:assert/strict";
import {
  fileStatus,
  fileStats,
  buildTree,
  toGitStatus,
  statsDecoration,
  fileDecoration,
} from "./tree.ts";
import type { FileDiffMetadata } from "@pierre/diffs";

function fileDiff(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
  return {
    name: "a.ts",
    type: "change",
    hunks: [],
    splitLineCount: 0,
    ...overrides,
  } as FileDiffMetadata;
}

// ---------------------------------------------------------------------------
// fileStatus
// ---------------------------------------------------------------------------

test("fileStatus: new -> A", () => {
  assert.equal(fileStatus(fileDiff({ type: "new" }), false), "A");
});

test("fileStatus: deleted -> D", () => {
  assert.equal(fileStatus(fileDiff({ type: "deleted" }), false), "D");
});

test("fileStatus: rename-pure / rename-changed -> R", () => {
  assert.equal(fileStatus(fileDiff({ type: "rename-pure" }), false), "R");
  assert.equal(fileStatus(fileDiff({ type: "rename-changed" }), false), "R");
});

test("fileStatus: change -> M", () => {
  assert.equal(fileStatus(fileDiff({ type: "change" }), false), "M");
});

test("fileStatus: untracked -> U regardless of type", () => {
  assert.equal(fileStatus(fileDiff({ type: "change" }), true), "U");
  assert.equal(fileStatus(fileDiff({ type: "new" }), true), "U");
  assert.equal(fileStatus(fileDiff({ type: "deleted" }), true), "U");
});

// ---------------------------------------------------------------------------
// toGitStatus
// ---------------------------------------------------------------------------

test("toGitStatus: maps each single-letter status to PathTree's GitStatus", () => {
  assert.equal(toGitStatus("A"), "added");
  assert.equal(toGitStatus("M"), "modified");
  assert.equal(toGitStatus("D"), "deleted");
  assert.equal(toGitStatus("R"), "renamed");
  assert.equal(toGitStatus("U"), "untracked");
});

// ---------------------------------------------------------------------------
// statsDecoration
// ---------------------------------------------------------------------------

test("statsDecoration: shows +additions/-deletions, omitting zero parts", () => {
  assert.equal(statsDecoration({ additions: 3, deletions: 1 }).text, "+3 −1");
  assert.equal(statsDecoration({ additions: 5, deletions: 0 }).text, "+5");
  assert.equal(statsDecoration({ additions: 0, deletions: 8 }).text, "−8");
  assert.equal(statsDecoration({ additions: 0, deletions: 0 }).text, "");
});

// ---------------------------------------------------------------------------
// fileDecoration
// ---------------------------------------------------------------------------

// 無いと壊れる: stats と status letter をマージする際にどちらかを取りこぼす
// (例: 文字列連結の順序ミスで letter が欠ける)。
test("fileDecoration: keeps the status letter even when a file has no stat changes (e.g. a pure rename)", () => {
  assert.equal(fileDecoration("R", { additions: 0, deletions: 0 }).text, "R");
});

test("fileDecoration: combines stats and the trailing status letter", () => {
  assert.equal(fileDecoration("M", { additions: 3, deletions: 1 }).text, "+3 −1 M");
});

// ---------------------------------------------------------------------------
// fileStats
// ---------------------------------------------------------------------------

test("fileStats: sums additionLines/deletionLines across hunks, not *Count", () => {
  const file = fileDiff({
    hunks: [
      { additionLines: 3, deletionLines: 1, additionCount: 20, deletionCount: 20 } as never,
      { additionLines: 2, deletionLines: 0, additionCount: 20, deletionCount: 20 } as never,
    ],
  });
  assert.deepEqual(fileStats(file), { additions: 5, deletions: 1 });
});

test("fileStats: no hunks -> zero", () => {
  assert.deepEqual(fileStats(fileDiff({ hunks: [] })), { additions: 0, deletions: 0 });
});

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

function entry(
  name: string,
  overrides: Partial<{
    id: string;
    status: "A" | "M" | "D" | "R" | "U";
    additions: number;
    deletions: number;
  }> = {},
) {
  return {
    id: `diff:${name}#1`,
    name,
    status: "M" as const,
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

test("buildTree: flat list of root files, sorted alphabetically", () => {
  const tree = buildTree([entry("b.ts"), entry("a.ts")]);
  assert.deepEqual(
    tree.map((n) => n.label),
    ["a.ts", "b.ts"],
  );
  assert.equal(tree[0]!.kind, "file");
});

test("buildTree: nests directories by /", () => {
  const tree = buildTree([entry("src/index.ts"), entry("README.md")]);
  assert.equal(tree.length, 2);
  const dir = tree[0]!;
  const file = tree[1]!;
  assert.equal(dir.kind, "dir");
  assert.equal(file.kind, "file");
  if (dir.kind !== "dir") throw new Error("expected dir");
  assert.equal(dir.label, "src");
  assert.equal(dir.path, "src");
  assert.equal(dir.children.length, 1);
  assert.equal(dir.children[0]!.kind, "file");
  assert.equal(dir.children[0]!.label, "index.ts");
});

test("buildTree: compacts a chain of single-child directories into one label", () => {
  const tree = buildTree([entry("apps/docs/app/page.ts")]);
  assert.equal(tree.length, 1);
  const dir = tree[0]!;
  assert.equal(dir.kind, "dir");
  if (dir.kind !== "dir") throw new Error("expected dir");
  assert.equal(dir.label, "apps/docs/app");
  assert.equal(dir.path, "apps/docs/app");
  assert.equal(dir.children.length, 1);
  assert.equal(dir.children[0]!.kind, "file");
  assert.equal(dir.children[0]!.label, "page.ts");
});

test("buildTree: a directory that has files of its own prevents compaction through it", () => {
  const tree = buildTree([entry("apps/README.md"), entry("apps/docs/app/page.ts")]);
  assert.equal(tree.length, 1);
  const dir = tree[0]!;
  assert.equal(dir.kind, "dir");
  if (dir.kind !== "dir") throw new Error("expected dir");
  // apps itself has a file, so it can't merge with docs/app.
  assert.equal(dir.label, "apps");
  assert.equal(dir.path, "apps");
  // children: docs/app (compacted) dir first, then README.md file.
  assert.equal(dir.children.length, 2);
  const child0 = dir.children[0]!;
  const child1 = dir.children[1]!;
  assert.equal(child0.kind, "dir");
  if (child0.kind === "dir") assert.equal(child0.label, "docs/app");
  assert.equal(child1.kind, "file");
  if (child1.kind === "file") assert.equal(child1.label, "README.md");
});

test("buildTree: sibling directory prevents compaction of another chain", () => {
  const tree = buildTree([entry("apps/docs/page.ts"), entry("apps/src/index.ts")]);
  assert.equal(tree.length, 1);
  const dir = tree[0]!;
  assert.equal(dir.kind, "dir");
  if (dir.kind !== "dir") throw new Error("expected dir");
  // apps has two subdirectories, so it stays as its own node.
  assert.equal(dir.label, "apps");
  assert.equal(dir.children.length, 2);
  assert.deepEqual(
    dir.children.map((c) => c.label),
    ["docs", "src"],
  );
});

test("buildTree: dirs sort before files, both alphabetically", () => {
  const tree = buildTree([entry("z.ts"), entry("a/b.ts"), entry("a.ts")]);
  assert.deepEqual(
    tree.map((n) => n.label),
    ["a", "a.ts", "z.ts"],
  );
});

// 無いと壊れる: 単純な `<` 比較だと大文字が小文字よりも先に来る・"file10" が
// "file2" より前に来るため、左の PathTree（@pierre/trees の自然順・小文字化
// ソート）でクリックした順序と、右ビューア／j-k の順序が食い違う。
test("buildTree: sorts case-insensitively with natural (numeric-aware) order, matching PathTree", () => {
  const tree = buildTree([
    entry("file10.ts"),
    entry("file2.ts"),
    entry("Banners.tsx"),
    entry("annotationVersion.ts"),
  ]);
  assert.deepEqual(
    tree.map((n) => n.label),
    ["annotationVersion.ts", "Banners.tsx", "file2.ts", "file10.ts"],
  );
});

test("buildTree: handles Japanese names", () => {
  const tree = buildTree([entry("ソース/あ.ts"), entry("ソース/い.ts")]);
  assert.equal(tree.length, 1);
  const dir = tree[0]!;
  assert.equal(dir.kind, "dir");
  if (dir.kind !== "dir") throw new Error("expected dir");
  assert.equal(dir.label, "ソース");
  assert.equal(dir.children.length, 2);
  assert.deepEqual(
    dir.children.map((c) => c.label),
    ["あ.ts", "い.ts"],
  );
});

test("buildTree: a renamed file (name already the new path) shows the new name", () => {
  const tree = buildTree([entry("new-name.ts", { status: "R" })]);
  assert.equal(tree.length, 1);
  const node = tree[0]!;
  assert.equal(node.kind, "file");
  if (node.kind !== "file") throw new Error("expected file");
  assert.equal(node.label, "new-name.ts");
  assert.equal(node.status, "R");
});

test("buildTree: file node carries id/status/additions/deletions", () => {
  const tree = buildTree([
    entry("a.ts", { id: "diff:a.ts#1", status: "A", additions: 4, deletions: 2 }),
  ]);
  const node = tree[0]!;
  assert.equal(node.kind, "file");
  if (node.kind !== "file") throw new Error("expected file");
  assert.equal(node.id, "diff:a.ts#1");
  assert.equal(node.status, "A");
  assert.equal(node.additions, 4);
  assert.equal(node.deletions, 2);
  assert.equal(node.path, "a.ts");
});
