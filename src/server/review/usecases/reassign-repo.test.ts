import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../../contract/review";
import { FakeReviewRepository } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { reassignRepoUsecase } from "./reassign-repo";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

describe("reassignRepoUsecase", () => {
  test("delegates to repository.moveRepo and returns the counts", async () => {
    const repository = new FakeReviewRepository();
    await repository.upsertRepo({
      key: "/repo",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });
    await repository.save(
      createReview(
        {
          id: "r1",
          repo: "/repo",
          target: { kind: "worktree", root: "/repo" },
          worktreeRoot: "/repo",
          path: "a.ts",
          anchor: ANCHOR,
          createdAtHead: "head1",
          viewedAs: { from: "WORKTREE", to: "WORKTREE" },
          body: "why?",
        },
        { now: () => new Date("2026-01-01T00:00:00.000Z") },
      ),
    );

    const usecase = reassignRepoUsecase({ repository });
    const result = await usecase({ from: "/repo", to: "/new/repo" });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ repos: 1, reviews: 1 });
    expect((await repository.get("r1"))?.repo).toBe("/new/repo");
  });

  // F8: trailing slashes on from/to must not create a boundary mismatch
  // (e.g. "/repo/" vs "/repo" would otherwise fail to match anything).
  test("normalizes trailing slashes on from/to", async () => {
    const repository = new FakeReviewRepository();
    await repository.upsertRepo({
      key: "/repo",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });

    const usecase = reassignRepoUsecase({ repository });
    const result = await usecase({ from: "/repo/", to: "/new/repo/" });
    expect(result.isOk()).toBe(true);
    expect(await repository.getRepo("/new/repo")).not.toBeNull();
    expect(await repository.getRepo("/new/repo/")).toBeNull();
  });

  // F8: moving onto an already-registered repo key must be rejected (409 at the route),
  // not silently merged into the existing repo's reviews.
  test("rejects with already_exists when `to` is already a registered repo key", async () => {
    const repository = new FakeReviewRepository();
    await repository.upsertRepo({
      key: "/repo",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });
    await repository.upsertRepo({
      key: "/other",
      rootCommit: null,
      name: "other",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });

    const usecase = reassignRepoUsecase({ repository });
    const result = await usecase({ from: "/repo", to: "/other" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("already_exists");
    // the move must not have partially applied
    expect(await repository.getRepo("/repo")).not.toBeNull();
  });

  test("moving a repo onto itself (from === to) is not an already_exists conflict", async () => {
    const repository = new FakeReviewRepository();
    await repository.upsertRepo({
      key: "/repo",
      rootCommit: null,
      name: "repo",
      firstSeenAt: "t",
      lastSeenAt: "t",
    });

    const usecase = reassignRepoUsecase({ repository });
    const result = await usecase({ from: "/repo", to: "/repo" });
    expect(result.isOk()).toBe(true);
  });
});
