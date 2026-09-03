import { describe, expect, test } from "vitest";
import type { Review } from "@contract/review";
import { reviewEventMatchesRepo, reviewEventRepo } from "./reviewEvent";

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    repo: "/r/.git",
    target: { kind: "worktree", root: "/r" },
    worktreeRoot: "/r",
    path: "a.txt",
    anchor: { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [{ seq: 0, author: "user", body: "check this", at: "t", agentSession: null }],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

describe("reviewEventRepo", () => {
  test("extracts repo from a review event", () => {
    const event = { type: "review" as const, event: "created" as const, review: review() };
    expect(reviewEventRepo(event)).toBe("/r/.git");
  });

  test("returns null for review-notify (no review payload at all)", () => {
    const event = {
      type: "review-notify" as const,
      reviewId: "r1",
      result: "sent" as const,
      pane: null,
    };
    expect(reviewEventRepo(event)).toBeNull();
  });
});

describe("reviewEventMatchesRepo", () => {
  test("matches when the event's repo equals repoKey", () => {
    const event = { type: "review" as const, event: "created" as const, review: review() };
    expect(reviewEventMatchesRepo(event, "/r/.git")).toBe(true);
  });

  test("does not match a different repo", () => {
    const event = { type: "review" as const, event: "created" as const, review: review() };
    expect(reviewEventMatchesRepo(event, "/other/.git")).toBe(false);
  });

  test("passes through (not filtered) when repoKey is null/unresolved", () => {
    const event = { type: "review" as const, event: "created" as const, review: review() };
    expect(reviewEventMatchesRepo(event, null)).toBe(true);
  });

  test("passes through review-notify (repo unknowable) regardless of repoKey", () => {
    const event = {
      type: "review-notify" as const,
      reviewId: "r1",
      result: "sent" as const,
      pane: null,
    };
    expect(reviewEventMatchesRepo(event, "/r/.git")).toBe(true);
  });
});
