import assert from "node:assert/strict";
import { test } from "vitest";
import type { CommitFile } from "@contract/git";
import { buildDecorations, buildGitStatus, toGitStatus } from "./fileDecorations.ts";

test("toGitStatus: maps each FileStatus letter to a GitStatus", () => {
  assert.equal(toGitStatus("A"), "added");
  assert.equal(toGitStatus("M"), "modified");
  assert.equal(toGitStatus("D"), "deleted");
  assert.equal(toGitStatus("R"), "renamed");
  assert.equal(toGitStatus("C"), "added");
  assert.equal(toGitStatus("T"), "modified");
  assert.equal(toGitStatus("U"), "modified");
});

test("buildGitStatus: maps each file's path/status for PathTree's gitStatus prop", () => {
  const files: CommitFile[] = [
    { status: "M", path: "src/a.ts", additions: 1, deletions: 1 },
    { status: "D", path: "README.md", additions: 0, deletions: 8 },
  ];
  assert.deepEqual(buildGitStatus(files), [
    { path: "src/a.ts", status: "modified" },
    { path: "README.md", status: "deleted" },
  ]);
});

test("buildDecorations: a binary file (null additions/deletions) shows 'bin' and its status letter", () => {
  const files: CommitFile[] = [{ status: "M", path: "bin.dat", additions: null, deletions: null }];
  const decorations = buildDecorations(files);
  assert.equal(decorations.get("bin.dat")?.text, "bin M");
});

// 無いと壊れる: PathTree の組み込み git-status レーンは untracked を常に "U"
// と表示し色も付かない（design.pen: M=amber/?=gray/A=green/D=red）ため、この
// 行末の文字が唯一の色付き表示手段になる。
test("buildDecorations: a text file shows +additions/-deletions and its status letter, omitting zero parts", () => {
  const files: CommitFile[] = [
    { status: "M", path: "src/a.ts", additions: 5, deletions: 2 },
    { status: "A", path: "src/new.ts", additions: 5, deletions: 0 },
  ];
  const decorations = buildDecorations(files);
  assert.equal(decorations.get("src/a.ts")?.text, "+5 −2 M");
  assert.equal(decorations.get("src/new.ts")?.text, "+5 A");
});
