import { describe, expect, test } from "bun:test";
import type { Review } from "../../../contract/review";
import { buildAnchor } from "../domain/anchor";
import { FakeReviewRepository } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { forDiffUsecase } from "./for-diff";

const CLOCK = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const NEW_LINES = ["const a = 1;", "const b = 2;", "const c = 3;"];

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: overrides.id ?? "r1",
        repo: "/repo",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: buildAnchor(NEW_LINES, 1, "new"),
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    ),
    ...overrides,
  };
}

describe("forDiffUsecase", () => {
  test("matches worktree-bound reviews for the given worktree when to=WORKTREE", async () => {
    const repository = new FakeReviewRepository();
    await repository.save(makeReview({ id: "r1", worktreeRoot: "/repo" }));
    await repository.save(makeReview({ id: "r2", worktreeRoot: "/other" }));

    const usecase = forDiffUsecase({ repository });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      from: "HEAD",
      to: "WORKTREE",
      path: "a.ts",
      sideLines: { old: [], new: NEW_LINES },
    });
    const matches = result._unsafeUnwrap();
    expect(matches).toHaveLength(1);
    expect(matches[0]?.review.id).toBe("r1");
    expect(matches[0]?.line).toBe(2);
    expect(matches[0]?.confidence).toBe("exact");
  });

  test("matches commit-bound reviews for the given commit when to is a commit hash", async () => {
    const repository = new FakeReviewRepository();
    await repository.save(makeReview({ id: "c1", target: { kind: "commit", hash: "abc" } }));
    await repository.save(makeReview({ id: "c2", target: { kind: "commit", hash: "def" } }));

    const usecase = forDiffUsecase({ repository });
    const result = await usecase({
      repo: "/repo",
      from: "abc~1",
      to: "abc",
      path: "a.ts",
      sideLines: { old: [], new: NEW_LINES },
    });
    const matches = result._unsafeUnwrap();
    expect(matches.map((m) => m.review.id)).toEqual(["c1"]);
  });

  test("returns no match when the anchored line can't be located", async () => {
    const repository = new FakeReviewRepository();
    await repository.save(makeReview({ id: "r1" }));

    const usecase = forDiffUsecase({ repository });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      from: "HEAD",
      to: "WORKTREE",
      path: "a.ts",
      sideLines: { old: [], new: ["nothing", "matches", "here"] },
    });
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });
});
