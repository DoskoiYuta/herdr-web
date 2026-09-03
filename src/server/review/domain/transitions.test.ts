import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import type { Clock } from "./clock";
import {
  createReview,
  markOutdated,
  reanchorToCommit,
  reply,
  resolve,
  retargetCommit,
} from "./transitions";

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

const ANCHOR: Anchor = {
  side: "new",
  line: "const a = 1;",
  before: [],
  after: [],
  lineHint: 1,
  hash: "h",
};

function baseReview(overrides: Partial<Review> = {}): Review {
  const clock = fixedClock("2026-01-01T00:00:00.000Z");
  const created = createReview(
    {
      id: "id-1",
      repo: "/repo/.git",
      target: { kind: "worktree", root: "/repo" },
      worktreeRoot: "/repo",
      path: "a.ts",
      anchor: ANCHOR,
      createdAtHead: "head1",
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "why?",
    },
    clock,
  );
  return { ...created, ...overrides };
}

describe("createReview", () => {
  test("starts open with a single user entry at seq 0", () => {
    const review = baseReview();
    expect(review.status).toBe("open");
    expect(review.thread).toHaveLength(1);
    expect(review.thread[0]).toMatchObject({ seq: 0, author: "user", body: "why?" });
    expect(review.createdAt).toBe(review.updatedAt);
  });
});

describe("reply — full [status, author] matrix", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test("open + agent -> replied", () => {
    const r = reply(baseReview({ status: "open" }), { author: "agent", body: "done" }, later);
    expect(r.isOk() && r.value.status).toBe("replied");
  });

  test("replied + agent -> replied", () => {
    const r = reply(baseReview({ status: "replied" }), { author: "agent", body: "more" }, later);
    expect(r.isOk() && r.value.status).toBe("replied");
  });

  test("open + user -> open", () => {
    const r = reply(baseReview({ status: "open" }), { author: "user", body: "ping" }, later);
    expect(r.isOk() && r.value.status).toBe("open");
  });

  test("replied + user -> open", () => {
    const r = reply(
      baseReview({ status: "replied" }),
      { author: "user", body: "not quite" },
      later,
    );
    expect(r.isOk() && r.value.status).toBe("open");
  });

  test("resolved + user -> open (reopen)", () => {
    const r = reply(baseReview({ status: "resolved" }), { author: "user", body: "reopen" }, later);
    expect(r.isOk() && r.value.status).toBe("open");
  });

  test("resolved + agent -> not_repliable", () => {
    const r = reply(baseReview({ status: "resolved" }), { author: "agent", body: "x" }, later);
    expect(r.isErr() && r.error.type).toBe("not_repliable");
  });

  test("outdated + user -> stays outdated (append only)", () => {
    const r = reply(baseReview({ status: "outdated" }), { author: "user", body: "note" }, later);
    expect(r.isOk() && r.value.status).toBe("outdated");
    expect(r.isOk() && r.value.thread).toHaveLength(2);
  });

  test("outdated + agent -> not_repliable", () => {
    const r = reply(baseReview({ status: "outdated" }), { author: "agent", body: "x" }, later);
    expect(r.isErr() && r.error.type).toBe("not_repliable");
  });

  test("appends an entry with incrementing seq and updates updatedAt", () => {
    const review = baseReview({ status: "open" });
    const r = reply(review, { author: "agent", body: "done", agentSession: "sess-1" }, later);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.thread).toHaveLength(2);
      expect(r.value.thread[1]).toMatchObject({ seq: 1, author: "agent", agentSession: "sess-1" });
      expect(r.value.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    }
  });
});

describe("resolve", () => {
  const clock = fixedClock("2026-01-03T00:00:00.000Z");

  test.each(["open", "replied", "outdated"] as const)("%s -> resolved", (status) => {
    const r = resolve(baseReview({ status }), clock);
    expect(r.isOk() && r.value.status).toBe("resolved");
  });

  test("resolved -> already_resolved", () => {
    const r = resolve(baseReview({ status: "resolved" }), clock);
    expect(r.isErr() && r.error.type).toBe("already_resolved");
  });
});

describe("markOutdated", () => {
  const clock = fixedClock("2026-01-04T00:00:00.000Z");

  test.each(["open", "replied"] as const)("worktree-bound %s -> outdated", (status) => {
    const r = markOutdated(baseReview({ status }), clock);
    expect(r.isOk() && r.value.status).toBe("outdated");
  });

  test.each(["resolved", "outdated"] as const)("worktree-bound %s -> not_outdatable", (status) => {
    const r = markOutdated(baseReview({ status }), clock);
    expect(r.isErr() && r.error.type).toBe("not_outdatable");
  });

  test("commit-bound review is never outdatable", () => {
    const review = baseReview({ status: "open", target: { kind: "commit", hash: "abc" } });
    const r = markOutdated(review, clock);
    expect(r.isErr() && r.error.type).toBe("not_outdatable");
  });
});

describe("reanchorToCommit", () => {
  const clock = fixedClock("2026-01-05T00:00:00.000Z");

  test("worktree-bound open -> commit-bound open", () => {
    const r = reanchorToCommit(baseReview({ status: "open" }), "commit1", clock);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.target).toEqual({ kind: "commit", hash: "commit1" });
      expect(r.value.status).toBe("open");
    }
  });

  test("worktree-bound outdated -> commit-bound open (revives)", () => {
    const r = reanchorToCommit(baseReview({ status: "outdated" }), "commit1", clock);
    expect(r.isOk() && r.value.status).toBe("open");
  });

  test("worktree-bound replied -> commit-bound replied (status preserved)", () => {
    const r = reanchorToCommit(baseReview({ status: "replied" }), "commit1", clock);
    expect(r.isOk() && r.value.status).toBe("replied");
  });

  test("already commit-bound -> already_committed", () => {
    const review = baseReview({ status: "open", target: { kind: "commit", hash: "abc" } });
    const r = reanchorToCommit(review, "def", clock);
    expect(r.isErr() && r.error.type).toBe("already_committed");
  });
});

describe("retargetCommit", () => {
  const clock = fixedClock("2026-01-06T00:00:00.000Z");

  test("commit-bound -> retargeted, status unchanged", () => {
    const review = baseReview({ status: "replied", target: { kind: "commit", hash: "old" } });
    const r = retargetCommit(review, "new", clock);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.target).toEqual({ kind: "commit", hash: "new" });
      expect(r.value.status).toBe("replied");
    }
  });

  test("worktree-bound -> not_commit_bound", () => {
    const r = retargetCommit(baseReview({ status: "open" }), "new", clock);
    expect(r.isErr() && r.error.type).toBe("not_commit_bound");
  });
});
