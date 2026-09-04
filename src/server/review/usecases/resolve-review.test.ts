import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { resolveReviewUsecase } from "./resolve-review";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };

async function seedReview(
  repository: FakeReviewRepository,
  overrides: Partial<Review> = {},
): Promise<Review> {
  const review = {
    ...createReview(
      {
        id: "r1",
        repo: "/repo/.git",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head1",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      new ManualClock("2026-01-01T00:00:00.000Z"),
    ),
    ...overrides,
  };
  await repository.save(review);
  return review;
}

describe("resolveReviewUsecase", () => {
  test("resolves an open review and emits resolved", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await seedReview(repository, { status: "replied" });
    const usecase = resolveReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase("r1");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe("resolved");
    expect(events.events).toEqual([
      { type: "review", event: "resolved", review: result._unsafeUnwrap() },
    ]);
  });

  test("returns already_resolved when already resolved", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await seedReview(repository, { status: "resolved" });
    const usecase = resolveReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase("r1");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("already_resolved");
  });

  test("returns not_found for an unknown id", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const usecase = resolveReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase("missing");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("not_found");
  });
});
