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
});
