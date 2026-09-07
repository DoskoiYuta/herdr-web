import { describe, expect, test } from "bun:test";
import type { AskWithSession } from "../contract/ask";
import type { Review } from "../contract/review";
import {
  formatAskShow,
  formatReviewList,
  formatReviewLine,
  formatReviewShow,
  formatStatus,
  formatTarget,
  shortId,
} from "./format";

function makeAskWithSession(overrides: Partial<AskWithSession> = {}): AskWithSession {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    path: "src/a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc123",
    status: "open",
    session: { kind: "herdr", label: "ask:abc12345", agent: "claude" },
    sessionStatus: "working",
    thread: [
      { seq: 0, author: "user", body: "why?", at: "2026-01-01T00:00:00Z", agentSession: null },
    ],
    lastPrompt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "src/foo.ts",
    anchor: {
      side: "new",
      lines: ["  return 1;"],
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
        draft: false,
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
    expect(shortId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("Q69G5FAV");
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
    expect(line).toBe("Q69G5FAV open src/foo.ts:42 [worktree] why is this here?");
  });

  test("truncates the first thread body to 60 chars and collapses whitespace", () => {
    const longBody = "x".repeat(80);
    const line = formatReviewLine(
      makeReview({
        thread: [
          { seq: 0, author: "user", body: longBody, at: "t", agentSession: null, draft: false },
        ],
      }),
    );
    expect(line.endsWith("x".repeat(60))).toBe(true);
  });

  test("empty thread yields empty tail, no crash", () => {
    const line = formatReviewLine(makeReview({ thread: [] }));
    expect(line).toBe("Q69G5FAV open src/foo.ts:42 [worktree] ");
  });

  test("shows a range when the anchor spans multiple lines", () => {
    const line = formatReviewLine(
      makeReview({
        anchor: {
          side: "new",
          lines: ["  return 1;", "  return 2;", "  return 3;"],
          before: ["function foo() {"],
          after: ["}"],
          lineHint: 42,
          hash: "deadbeef",
        },
      }),
    );
    expect(line).toBe("Q69G5FAV open src/foo.ts:42-44 [worktree] why is this here?");
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

  test("prints every selected line of a multi-line anchor with the > prefix", () => {
    const out = formatReviewShow(
      makeReview({
        anchor: {
          side: "new",
          lines: ["  return 1;", "  return 2;"],
          before: ["function foo() {"],
          after: ["}"],
          lineHint: 42,
          hash: "deadbeef",
        },
      }),
    );
    expect(out).toContain("  >   return 1;");
    expect(out).toContain("  >   return 2;");
  });
});

describe("formatAskShow", () => {
  // 無いと壊れる: どのエージェントが答えているかが `hw ask show` だけでは分からず、
  // pane に手動で移動して確かめる必要が出る。
  test("includes the session's agent when present", () => {
    const out = formatAskShow(makeAskWithSession());
    expect(out).toContain("agent: claude");
  });

  test.each([
    [{ kind: "pane", paneId: "p1" } as const, "不明"],
    [{ kind: "herdr", label: "ask:x", agent: null } as const, "不明"],
  ])("shows 不明 when the session has no agent (%j)", (session, expected) => {
    const out = formatAskShow(makeAskWithSession({ session }));
    expect(out).toContain(`agent: ${expected}`);
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
