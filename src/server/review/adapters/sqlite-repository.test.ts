import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { openDb, type Db } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { createSqliteReviewRepository } from "./sqlite-repository";

const ANCHOR: Anchor = {
  side: "new",
  line: "x",
  before: ["a"],
  after: ["b"],
  lineHint: 1,
  hash: "h",
};

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: overrides.id ?? "r1",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.ts",
    anchor: ANCHOR,
    createdAtHead: "head1",
    viewedAs: { from: "WORKTREE", to: "WORKTREE" },
    status: "open",
    thread: [
      { seq: 0, author: "user", body: "why?", at: "2026-01-01T00:00:00.000Z", agentSession: null },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  applyMigrations(db);
});

describe("createSqliteReviewRepository", () => {
  test("save + get round-trips a review including its thread", async () => {
    const repo = createSqliteReviewRepository(db);
    const review = makeReview();
    await repo.save(review);
    const got = await repo.get(review.id);
    expect(got).toEqual(review);
  });

  test("get returns null for an unknown id", async () => {
    const repo = createSqliteReviewRepository(db);
    expect(await repo.get("missing")).toBeNull();
  });

  test("save is an upsert and thread entries are replaced wholesale", async () => {
    const repo = createSqliteReviewRepository(db);
    const review = makeReview();
    await repo.save(review);

    const updated: Review = {
      ...review,
      status: "replied",
      thread: [
        ...review.thread,
        {
          seq: 1,
          author: "agent",
          body: "done",
          at: "2026-01-02T00:00:00.000Z",
          agentSession: "s1",
        },
      ],
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    await repo.save(updated);

    const got = await repo.get(review.id);
    expect(got?.status).toBe("replied");
    expect(got?.thread).toHaveLength(2);
    expect(got?.thread[1]).toMatchObject({ author: "agent", body: "done" });
  });

  test("list filters by repo, status, targetKind, worktreeRoot, commit, path", async () => {
    const repo = createSqliteReviewRepository(db);
    await repo.save(makeReview({ id: "r1", status: "open" }));
    await repo.save(makeReview({ id: "r2", status: "resolved" }));
    await repo.save(
      makeReview({
        id: "r3",
        repo: "/other/.git",
        status: "replied",
        worktreeRoot: "/other",
        target: { kind: "commit", hash: "deadbeef" },
        path: "b.ts",
      }),
    );

    expect((await repo.list({ repo: "/repo/.git" })).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect((await repo.list({ status: ["open"] })).map((r) => r.id)).toEqual(["r1"]);
    expect((await repo.list({ targetKind: "commit" })).map((r) => r.id)).toEqual(["r3"]);
    expect((await repo.list({ worktreeRoot: "/repo" })).map((r) => r.id).sort()).toEqual([
      "r1",
      "r2",
    ]);
    expect((await repo.list({ commit: "deadbeef" })).map((r) => r.id)).toEqual(["r3"]);
    expect((await repo.list({ path: "b.ts" })).map((r) => r.id)).toEqual(["r3"]);
    expect(await repo.list({})).toHaveLength(3);
  });

  test("upsertRepo inserts then updates without clobbering firstSeenAt", async () => {
    const repo = createSqliteReviewRepository(db);
    await repo.upsertRepo({
      key: "/repo/.git",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.upsertRepo({
      key: "/repo/.git",
      rootCommit: "abc",
      name: "repo",
      firstSeenAt: "2026-01-05T00:00:00.000Z", // should be ignored on update
      lastSeenAt: "2026-01-02T00:00:00.000Z",
    });
    const got = await repo.getRepo("/repo/.git");
    expect(got).toMatchObject({
      rootCommit: "abc",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
    });
  });

  test("listRepos returns all registered repos", async () => {
    const repo = createSqliteReviewRepository(db);
    await repo.upsertRepo({
      key: "/a/.git",
      rootCommit: null,
      name: "a",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });
    await repo.upsertRepo({
      key: "/b/.git",
      rootCommit: null,
      name: "b",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });
    expect((await repo.listRepos()).map((r) => r.key)).toEqual(["/a/.git", "/b/.git"]);
  });

  describe("moveRepo", () => {
    test("rewrites repos.key, reviews.repo, worktree_root, and worktree target_value by prefix", async () => {
      const repo = createSqliteReviewRepository(db);
      await repo.upsertRepo({
        key: "/repo",
        rootCommit: null,
        name: "repo",
        firstSeenAt: "t",
        lastSeenAt: "t",
      });
      await repo.save(
        makeReview({
          id: "r1",
          repo: "/repo",
          worktreeRoot: "/repo",
          target: { kind: "worktree", root: "/repo" },
        }),
      );
      await repo.save(
        makeReview({
          id: "r2",
          repo: "/repo",
          worktreeRoot: "/repo/.claude/worktrees/feat",
          target: { kind: "worktree", root: "/repo/.claude/worktrees/feat" },
        }),
      );
      // commit-bound review: target_value must NOT be touched, but repo/worktreeRoot still are
      await repo.save(
        makeReview({
          id: "r3",
          repo: "/repo",
          worktreeRoot: "/repo",
          target: { kind: "commit", hash: "deadbeef" },
        }),
      );

      const result = await repo.moveRepo("/repo", "/new/repo");
      expect(result).toEqual({ repos: 1, reviews: 3 });

      expect(await repo.getRepo("/repo")).toBeNull();
      expect(await repo.getRepo("/new/repo")).not.toBeNull();

      const r1 = await repo.get("r1");
      expect(r1?.repo).toBe("/new/repo");
      expect(r1?.worktreeRoot).toBe("/new/repo");
      expect(r1?.target).toEqual({ kind: "worktree", root: "/new/repo" });

      const r2 = await repo.get("r2");
      expect(r2?.worktreeRoot).toBe("/new/repo/.claude/worktrees/feat");
      expect(r2?.target).toEqual({ kind: "worktree", root: "/new/repo/.claude/worktrees/feat" });

      const r3 = await repo.get("r3");
      expect(r3?.repo).toBe("/new/repo");
      expect(r3?.worktreeRoot).toBe("/new/repo");
      expect(r3?.target).toEqual({ kind: "commit", hash: "deadbeef" }); // unchanged
    });

    test("does not match a sibling path with the same prefix (e.g. /repo2 when moving /repo)", async () => {
      const repo = createSqliteReviewRepository(db);
      await repo.upsertRepo({
        key: "/repo2",
        rootCommit: null,
        name: "repo2",
        firstSeenAt: "t",
        lastSeenAt: "t",
      });
      await repo.save(
        makeReview({
          id: "r1",
          repo: "/repo2",
          worktreeRoot: "/repo2",
          target: { kind: "worktree", root: "/repo2" },
        }),
      );

      const result = await repo.moveRepo("/repo", "/new/repo");
      expect(result).toEqual({ repos: 0, reviews: 0 });
      expect(await repo.getRepo("/repo2")).not.toBeNull();
      const r1 = await repo.get("r1");
      expect(r1?.repo).toBe("/repo2");
    });
  });
});
