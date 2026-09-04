import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import type { Clock } from "./clock";
import {
  createReview,
  deleteDraft,
  editDraft,
  markOutdated,
  reanchorToCommit,
  reply,
  resolve,
  retargetCommit,
  send,
} from "./transitions";

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

const ANCHOR: Anchor = {
  side: "new",
  lines: ["const a = 1;"],
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

/** user の draft entry を送信済みにした review を作る（agent が返信できる前提を満たす） */
function sentReview(overrides: Partial<Review> = {}): Review {
  const created = baseReview();
  const result = send(created, fixedClock("2026-01-01T00:05:00.000Z"));
  if (result.isErr()) throw new Error("send failed in test fixture");
  return { ...result.value, ...overrides };
}

describe("createReview", () => {
  test("starts open with a single draft user entry and notify.state none", () => {
    const review = baseReview();
    expect(review.status).toBe("open");
    expect(review.thread).toHaveLength(1);
    expect(review.thread[0]).toMatchObject({ seq: 0, author: "user", body: "why?", draft: true });
    expect(review.notify.state).toBe("none");
    expect(review.createdAt).toBe(review.updatedAt);
  });
});

describe("reply — author=user always appends a draft without changing status", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test.each(["open", "replied", "resolved", "outdated"] as const)(
    "%s + user -> stays %s, appends a draft entry",
    (status) => {
      const r = reply(sentReview({ status }), { author: "user", body: "ping" }, later);
      expect(r.isOk()).toBe(true);
      if (!r.isOk()) return;
      expect(r.value.status).toBe(status);
      expect(r.value.thread.at(-1)).toMatchObject({ author: "user", body: "ping", draft: true });
    },
  );
});

describe("reply — author=agent", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test("open + agent -> replied, entry is not a draft", () => {
    const r = reply(sentReview({ status: "open" }), { author: "agent", body: "done" }, later);
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.status).toBe("replied");
    expect(r.value.thread.at(-1)).toMatchObject({ author: "agent", draft: false });
  });

  test("replied + agent -> replied", () => {
    const r = reply(sentReview({ status: "replied" }), { author: "agent", body: "more" }, later);
    expect(r.isOk() && r.value.status).toBe("replied");
  });

  test.each(["resolved", "outdated"] as const)("%s + agent -> not_repliable", (status) => {
    const r = reply(sentReview({ status }), { author: "agent", body: "x" }, later);
    expect(r.isErr() && r.error.type).toBe("not_repliable");
  });

  // Without this: an agent could reply to a review that only has a draft entry —
  // something the agent was never notified about and can't see via GET.
  test("no sent user entry -> not_repliable, even if status is open", () => {
    const r = reply(baseReview({ status: "open" }), { author: "agent", body: "x" }, later);
    expect(r.isErr() && r.error.type).toBe("not_repliable");
  });

  test("appends an entry with incrementing seq and updates updatedAt", () => {
    const review = sentReview({ status: "open" });
    const r = reply(review, { author: "agent", body: "done", agentSession: "sess-1" }, later);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.thread).toHaveLength(2);
      expect(r.value.thread[1]).toMatchObject({ seq: 1, author: "agent", agentSession: "sess-1" });
      expect(r.value.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    }
  });
});

describe("editDraft", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test("replaces the body and at of a draft entry", () => {
    const review = baseReview();
    const r = editDraft(review, 0, "revised", later);
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.thread[0]).toMatchObject({ body: "revised", at: "2026-01-02T00:00:00.000Z" });
  });

  // Without this: editing a seq that doesn't exist would silently no-op instead
  // of surfacing an error the route can turn into a 404/409.
  test("unknown seq -> not_draft", () => {
    const review = baseReview();
    const r = editDraft(review, 99, "x", later);
    expect(r.isErr() && r.error.type).toBe("not_draft");
  });

  // Without this: an agent's already-sent entry could be silently rewritten
  // through the same endpoint used for user drafts.
  test("entry exists but is not a draft -> not_draft", () => {
    const review = sentReview();
    const r = editDraft(review, 0, "x", later);
    expect(r.isErr() && r.error.type).toBe("not_draft");
  });
});

describe("deleteDraft", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test("removes the draft entry and keeps the other entries' seq stable, so a later edit/delete by seq hits the same entry", () => {
    let review = baseReview();
    const withSecond = reply(review, { author: "user", body: "second" }, later);
    review = withSecond._unsafeUnwrap();
    const withThird = reply(review, { author: "user", body: "third" }, later);
    review = withThird._unsafeUnwrap();

    const r = deleteDraft(review, 0, later);
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.thread.map((e) => [e.seq, e.body])).toEqual([
      [1, "second"],
      [2, "third"],
    ]);
    // a new entry never reuses a freed seq
    const appended = reply(r.value, { author: "user", body: "fourth" }, later)._unsafeUnwrap();
    expect(appended.thread.at(-1)?.seq).toBe(3);
  });

  test("unknown seq -> not_draft", () => {
    const review = baseReview();
    const r = deleteDraft(review, 99, later);
    expect(r.isErr() && r.error.type).toBe("not_draft");
  });

  test("entry exists but is not a draft -> not_draft", () => {
    const review = sentReview();
    const r = deleteDraft(review, 0, later);
    expect(r.isErr() && r.error.type).toBe("not_draft");
  });
});

describe("send", () => {
  const later = fixedClock("2026-01-02T00:00:00.000Z");

  test("marks every draft entry sent, schedules notify, and reopens a resolved review", () => {
    const r = send(baseReview({ status: "resolved" }), later);
    expect(r.isOk()).toBe(true);
    if (!r.isOk()) return;
    expect(r.value.thread.every((e) => !e.draft)).toBe(true);
    expect(r.value.thread[0]?.at).toBe("2026-01-02T00:00:00.000Z");
    expect(r.value.status).toBe("open");
    expect(r.value.notify.state).toBe("pending");
  });

  test("outdated stays outdated after send", () => {
    const r = send(baseReview({ status: "outdated" }), later);
    expect(r.isOk() && r.value.status).toBe("outdated");
  });

  // Without this: sending a review with nothing new to send would silently
  // re-notify the agent with an empty batch instead of surfacing an error.
  test("no draft entries -> no_drafts", () => {
    const review = sentReview();
    const r = send(review, later);
    expect(r.isErr() && r.error.type).toBe("no_drafts");
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
