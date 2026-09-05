import { expect, test } from "vitest";
import type { Ask } from "@/lib/api";
import type { ForFileMatch } from "@/lib/api";
import { anchoredMatches, buildAskAnnotations, outdatedMatches } from "./askAnnotations";

function ask(id: string): Ask {
  return {
    id,
    repo: "/repo",
    worktreeRoot: "/repo",
    path: "a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: null,
    status: "open",
    session: null,
    thread: [{ seq: 0, author: "user", body: "why?", at: "t", agentSession: null }],
    lastPrompt: null,
    createdAt: "t",
    updatedAt: "t",
  };
}

function match(id: string, startLine: number | null, endLine: number | null): ForFileMatch {
  return { ask: ask(id), startLine, endLine };
}

// Without this, an ask whose anchor no longer resolves would still try to
// render inline at a line it no longer has, instead of moving to the
// mismatch strip.
test("outdatedMatches keeps only matches with a null start or end line", () => {
  const anchored = match("a", 3, 3);
  const outdated = match("b", null, null);
  expect(outdatedMatches([anchored, outdated])).toEqual([outdated]);
});

test("anchoredMatches keeps only matches with a non-null end line", () => {
  const anchored = match("a", 3, 3);
  const outdated = match("b", null, null);
  expect(anchoredMatches([anchored, outdated])).toEqual([anchored]);
});

// Without this, two asks on the same line would render as two separate
// annotations (two composer/thread portals stacked at the same line) instead
// of one grouped thread list.
test("buildAskAnnotations groups matches anchored to the same endLine into one annotation", () => {
  const m1 = match("a", 2, 3);
  const m2 = match("b", 1, 3);
  const annotations = buildAskAnnotations([m1, m2], null);
  expect(annotations).toEqual([{ lineNumber: 3, metadata: { kind: "asks", matches: [m1, m2] } }]);
});

// Without this, opening the composer on a line with no existing thread would
// render nothing (the composer annotation is the only thing anchoring it).
test("buildAskAnnotations adds a composer annotation at composerLine", () => {
  const annotations = buildAskAnnotations([], 5);
  expect(annotations).toEqual([{ lineNumber: 5, metadata: { kind: "composer" } }]);
});

test("buildAskAnnotations drops matches whose endLine is null", () => {
  const outdated = match("b", null, null);
  expect(buildAskAnnotations([outdated], null)).toEqual([]);
});
