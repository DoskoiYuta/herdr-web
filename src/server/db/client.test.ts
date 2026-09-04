import { describe, expect, test } from "bun:test";
import { openDb } from "./client";
import { applyMigrations } from "./migrate";
import { repos, reviewEntries, reviews } from "./schema";

describe("openDb + applyMigrations", () => {
  test("creates the repos/reviews/review_entries tables", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);

    await db.insert(repos).values({
      key: "/repo/.git",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });

    await db.insert(reviews).values({
      id: "r1",
      repo: "/repo/.git",
      targetKind: "worktree",
      targetValue: "/repo",
      worktreeRoot: "/repo",
      path: "a.ts",
      anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
      createdAtHead: "head1",
      viewedFrom: "WORKTREE",
      viewedTo: "WORKTREE",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await db.insert(reviewEntries).values({
      reviewId: "r1",
      seq: 0,
      author: "user",
      body: "why?",
      at: "2026-01-01T00:00:00.000Z",
      agentSession: null,
    });

    const rows = await db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.anchor).toEqual({
      side: "new",
      lines: ["x"],
      before: [],
      after: [],
      lineHint: 1,
      hash: "h",
    });

    const entries = await db.select().from(reviewEntries).all();
    expect(entries).toHaveLength(1);
  });

  test("cascades delete of review_entries when the review is deleted", async () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    await db.insert(reviews).values({
      id: "r2",
      repo: "/repo/.git",
      targetKind: "commit",
      targetValue: "deadbeef",
      worktreeRoot: "/repo",
      path: "a.ts",
      anchor: { side: "old", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
      createdAtHead: "head1",
      viewedFrom: "WORKTREE",
      viewedTo: "deadbeef",
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(reviewEntries).values({
      reviewId: "r2",
      seq: 0,
      author: "user",
      body: "why?",
      at: "2026-01-01T00:00:00.000Z",
      agentSession: null,
    });

    const { eq } = await import("drizzle-orm");
    await db.delete(reviews).where(eq(reviews.id, "r2"));
    const entries = await db.select().from(reviewEntries).all();
    expect(entries).toHaveLength(0);
  });

  test("applying migrations twice is idempotent", () => {
    const db = openDb(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
  });
});
