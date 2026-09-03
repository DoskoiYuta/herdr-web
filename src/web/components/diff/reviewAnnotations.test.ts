import { parsePatchFiles } from "@pierre/diffs";
import { expect, test } from "vitest";
import type { Review } from "@contract/review";
import type { ForDiffMatch } from "@/lib/api";
import { buildAnnotations } from "./reviewAnnotations.ts";

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
  return parsePatchFiles(PATCH, "h1")[0]!.files[0]!;
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: { side: "new", line: "line2-changed", before: [], after: [], lineHint: 2, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [{ seq: 0, author: "user", body: "x", at: "t", agentSession: null }],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

test("buildAnnotations converts a forDiff match's sideLines index to a real line number", () => {
  const file = parseFile();
  // "line2-changed" is additionLines index 1 -> real new-side line 2.
  const match: ForDiffMatch = { review: review(), line: 2, confidence: "exact" };
  const annotations = buildAnnotations(file, [match], null);
  expect(annotations).toEqual([
    {
      side: "additions",
      lineNumber: 2,
      metadata: { kind: "reviews", side: "new", matches: [match] },
    },
  ]);
});

test("buildAnnotations groups multiple matches at the same line", () => {
  const file = parseFile();
  const a: ForDiffMatch = { review: review({ id: "a" }), line: 2, confidence: "exact" };
  const b: ForDiffMatch = { review: review({ id: "b" }), line: 2, confidence: "context" };
  const annotations = buildAnnotations(file, [a, b], null);
  expect(annotations).toHaveLength(1);
  expect(annotations[0]!.metadata).toMatchObject({ kind: "reviews", matches: [a, b] });
});

test("buildAnnotations drops matches whose sideLines index maps outside every hunk", () => {
  const file = parseFile();
  const match: ForDiffMatch = { review: review(), line: 999, confidence: "line" };
  expect(buildAnnotations(file, [match], null)).toEqual([]);
});

test("buildAnnotations adds a composer annotation at the given real line/side", () => {
  const file = parseFile();
  const annotations = buildAnnotations(file, [], { side: "old", lineNumber: 1 });
  expect(annotations).toEqual([
    { side: "deletions", lineNumber: 1, metadata: { kind: "composer", side: "old" } },
  ]);
});
