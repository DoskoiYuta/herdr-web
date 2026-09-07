import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../contract/review";
import { createReview } from "../review/domain/transitions";
import { ManualClock } from "../review/testing/fakes";
import { createTestApp } from "../testing/app-deps";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

describe("GET /api/inbox", () => {
  // 無いと壊れる: 集約 API がルートに配線されていないと、Inbox ダイアログは
  // 常に空のまま何も表示できない。
  test("returns a review draft as an unsent item", async () => {
    const { app, review } = createTestApp();
    const draft = createReview(
      {
        id: "r1",
        repo: "/repo",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    );
    await review.repository.save(draft);

    const res = await app.request("/api/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { section: string; worktreeRoot?: string | null }[];
    };
    expect(body.items.some((i) => i.section === "unsent" && i.worktreeRoot === "/repo")).toBe(true);
  });

  // 無いと壊れる: worktree クエリを渡しても絞り込みが効かないと、
  // Inbox の worktree 絞り込み Select が機能しない。
  test("worktree query filters the returned items", async () => {
    const { app, review } = createTestApp();
    const inA = createReview(
      {
        id: "a1",
        repo: "/repo",
        target: { kind: "worktree", root: "/wt-a" },
        worktreeRoot: "/wt-a",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    );
    const inB = createReview(
      {
        id: "b1",
        repo: "/repo",
        target: { kind: "worktree", root: "/wt-b" },
        worktreeRoot: "/wt-b",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    );
    await review.repository.save(inA);
    await review.repository.save(inB);

    const res = await app.request(`/api/inbox?${new URLSearchParams({ worktree: "/wt-a" })}`);
    const body = (await res.json()) as { items: { worktreeRoot?: string | null }[] };
    expect(body.items.every((i) => i.worktreeRoot === "/wt-a")).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });
});
