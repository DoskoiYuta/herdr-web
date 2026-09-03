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
});
