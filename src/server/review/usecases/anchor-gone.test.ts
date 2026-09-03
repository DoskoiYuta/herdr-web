import { describe, expect, test } from "bun:test";
import type { Review } from "../../../contract/review";
import { buildAnchor } from "../domain/anchor";
import { anchorGone } from "./reanchor-after-change";

function rv(anchor: Review["anchor"]): Review {
  return {
    id: "r",
    repo: "/r/.git",
    target: { kind: "worktree", root: "/r" },
    worktreeRoot: "/r",
    path: "a",
    anchor,
    createdAtHead: "h",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [],
    notify: { state: "none", pane: null, at: null },
    createdAt: "",
    updatedAt: "",
  };
}

describe("anchorGone", () => {
  const lines = ["one", "two", "three"];
  test("side=new: gone when the line is missing or the file is gone", () => {
    const r = rv(buildAnchor(lines, 1, "new"));
    expect(anchorGone(r, lines)).toBe(false);
    expect(anchorGone(r, ["one", "three"])).toBe(true);
    expect(anchorGone(r, null)).toBe(true);
  });
  test("side=old: gone only when the deleted line came back", () => {
    const r = rv(buildAnchor(lines, 1, "old"));
    expect(anchorGone(r, ["one", "three"])).toBe(false);
    expect(anchorGone(r, null)).toBe(false);
    expect(anchorGone(r, lines)).toBe(true);
  });

  // F1: a bare line match (no context on either side) is not solid enough evidence
  // to treat a `}`-style anchor as present/reverted — a different `}` elsewhere in
  // the file must not be mistaken for the one that was annotated.
  describe("F1: bare-line matches are not evidence", () => {
    const braces = ["function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}"];

    test("side=old: a deleted anchored `}` is NOT considered reverted just because another `}` remains", () => {
      // anchor the first function's closing brace (before=["  return 1;"], after=["", "function b() {"])
      const anchor = buildAnchor(braces, 2, "old");
      const r = rv(anchor);
      // delete the first function entirely; only the second function's `}` remains, unrelated context
      const afterDelete = ["function b() {", "  return 2;", "}"];
      expect(anchorGone(r, afterDelete)).toBe(false);
    });

    test("side=new: an anchored `}` that was deleted is gone even though another `}` remains", () => {
      const anchor = buildAnchor(braces, 2, "new");
      const r = rv(anchor);
      const afterDelete = ["function b() {", "  return 2;", "}"];
      expect(anchorGone(r, afterDelete)).toBe(true);
    });

    test("blank-line anchor: bare match on an unrelated blank line is not evidence", () => {
      const withBlanks = ["a", "", "b", "", "c"];
      // anchor the blank line between a and b (before=["a"], after=["b"])
      const anchor = buildAnchor(withBlanks, 1, "new");
      const r = rv(anchor);
      // context around the annotated blank line is gone, but another blank line remains
      const mutated = ["x", "", "y"];
      expect(anchorGone(r, mutated)).toBe(true);
    });
  });
});
