import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { CreateReviewRequestSchema, ListReviewQuerySchema, ReviewSchema } from "./review";

function sampleReview(): Record<string, unknown> {
  return {
    id: "01a0656e-cad2-7041-b69c-92c429f3d5c2",
    repo: "/home/user/repo/.git",
    target: { kind: "worktree", root: "/home/user/repo" },
    worktreeRoot: "/home/user/repo",
    path: "src/a.ts",
    anchor: {
      side: "new",
      lines: ["const a = 1;"],
      before: [],
      after: [],
      lineHint: 3,
      hash: "abc123",
    },
    createdAtHead: "deadbeef",
    viewedAs: { from: "WORKTREE", to: "WORKTREE" },
    status: "open",
    thread: [
      {
        seq: 0,
        author: "user",
        body: "why?",
        at: new Date().toISOString(),
        agentSession: null,
        draft: false,
      },
    ],
    notify: { state: "none", pane: null, at: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("ReviewSchema", () => {
  test("accepts a worktree-targeted review", () => {
    expect(v.safeParse(ReviewSchema, sampleReview()).success).toBe(true);
  });

  test("accepts a commit-targeted review", () => {
    const r = sampleReview();
    r.target = { kind: "commit", hash: "deadbeef" };
    expect(v.safeParse(ReviewSchema, r).success).toBe(true);
  });

  test("rejects an unknown target kind", () => {
    const r = sampleReview();
    r.target = { kind: "branch", name: "main" };
    expect(v.safeParse(ReviewSchema, r).success).toBe(false);
  });

  // F5: notify.state must persist the full result set, including the two
  // states that only exist server-side (pending before the first send, and
  // unknown after an exception/timeout during notification).
  test("accepts every notify.state value", () => {
    for (const state of ["pending", "sent", "agent_blocked", "no_target", "unknown", "none"]) {
      const r = sampleReview();
      r.notify = { state, pane: state === "sent" ? "p1" : null, at: null };
      expect(v.safeParse(ReviewSchema, r).success).toBe(true);
    }
  });

  test("rejects an unknown notify.state value", () => {
    const r = sampleReview();
    r.notify = { state: "bogus", pane: null, at: null };
    expect(v.safeParse(ReviewSchema, r).success).toBe(false);
  });

  test("rejects a review missing notify entirely", () => {
    const r = sampleReview();
    delete r.notify;
    expect(v.safeParse(ReviewSchema, r).success).toBe(false);
  });
});

describe("CreateReviewRequestSchema", () => {
  test("accepts a minimal create payload", () => {
    const payload = {
      repo: "/repo/.git",
      worktreeRoot: "/repo",
      target: { kind: "worktree", root: "/repo" },
      path: "a.ts",
      anchor: {
        side: "old",
        lines: ["x"],
        before: ["a", "b"],
        after: ["c"],
        lineHint: 1,
        hash: "h",
      },
      createdAtHead: "head",
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "please fix",
    };
    expect(v.safeParse(CreateReviewRequestSchema, payload).success).toBe(true);
  });
});

describe("ListReviewQuerySchema", () => {
  test("coerces boolean-ish query flags", () => {
    const r = v.safeParse(ListReviewQuerySchema, { uncommitted: "true", unreachable: "1" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.output.uncommitted).toBe(true);
      expect(r.output.unreachable).toBe(true);
    }
  });

  test("all fields optional", () => {
    expect(v.safeParse(ListReviewQuerySchema, {}).success).toBe(true);
  });
});
