import { describe, expect, test } from "bun:test";
import type { Review } from "../contract/review";
import {
  formatReviewList,
  formatReviewLine,
  formatReviewShow,
  formatStatus,
  formatTarget,
  shortId,
} from "./format";

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "src/foo.ts",
    anchor: {
      side: "new",
      line: "  return 1;",
      before: ["function foo() {"],
      after: ["}"],
      lineHint: 42,
      hash: "deadbeef",
    },
    createdAtHead: "abc123",
    viewedAs: { from: "WORKTREE", to: "HEAD" },
    status: "open",
    thread: [
      {
        seq: 0,
        author: "user",
        body: "why is this here?",
        at: "2026-01-01T00:00:00Z",
        agentSession: null,
      },
    ],
    notify: { state: "none", pane: null, at: null },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("shortId", () => {
  test("truncates to 8 chars", () => {
    expect(shortId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("01ARZ3ND");
  });
});

describe("formatTarget", () => {
  test("worktree target", () => {
    expect(formatTarget({ target: { kind: "worktree", root: "/repo" } })).toBe("worktree");
  });
  test("commit target shows short hash", () => {
    expect(formatTarget({ target: { kind: "commit", hash: "abcdef1234567890" } })).toBe(
      "commit:abcdef1",
    );
  });
});

describe("formatReviewLine", () => {
  test("matches the spec layout", () => {
    const line = formatReviewLine(makeReview());
    expect(line).toBe("01ARZ3ND open src/foo.ts:42 [worktree] why is this here?");
  });

  test("truncates the first thread body to 60 chars and collapses whitespace", () => {
    const longBody = "x".repeat(80);
    const line = formatReviewLine(
      makeReview({
        thread: [{ seq: 0, author: "user", body: longBody, at: "t", agentSession: null }],
      }),
    );
    expect(line.endsWith("x".repeat(60))).toBe(true);
  });

  test("empty thread yields empty tail, no crash", () => {
    const line = formatReviewLine(makeReview({ thread: [] }));
    expect(line).toBe("01ARZ3ND open src/foo.ts:42 [worktree] ");
  });
});

describe("formatReviewList", () => {
  test("one line per review plus a footer count", () => {
    const out = formatReviewList([makeReview(), makeReview({ id: "b".repeat(26) })]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("2 件");
  });

  test("empty list still prints the footer", () => {
    expect(formatReviewList([])).toBe("0 件");
  });
});

describe("formatReviewShow", () => {
  test("includes id, status, anchor context and thread", () => {
    const out = formatReviewShow(makeReview());
    expect(out).toContain("id: 01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(out).toContain("status: open");
    expect(out).toContain("function foo() {");
    expect(out).toContain("> ");
    expect(out).toContain("return 1;");
    expect(out).toContain("[user] 2026-01-01T00:00:00Z");
    expect(out).toContain("why is this here?");
  });
});

describe("formatStatus", () => {
  test("connected server", () => {
    const out = formatStatus({
      health: { ok: true, version: "0.1.0", herdr: { connected: true, protocol: 20 } },
      worktreeRoot: "/repo",
      repoKey: "/repo/.git",
      sessionKey: "claude-code:id:abc",
    });
    expect(out).toContain("server: ok");
    expect(out).toContain("worktree: /repo");
    expect(out).toContain("session: claude-code:id:abc");
  });

  test("unreachable server", () => {
    const out = formatStatus({ health: null, worktreeRoot: null, repoKey: null, sessionKey: null });
    expect(out).toContain("server: unreachable");
    expect(out).toContain("worktree: (unknown)");
    expect(out).toContain("session: (none)");
  });
});
