import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { replyToReviewUsecase } from "./reply-to-review";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

async function seedReview(
  repository: FakeReviewRepository,
  overrides: Partial<Review> = {},
): Promise<Review> {
  const clock = new ManualClock("2026-01-01T00:00:00.000Z");
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
      clock,
    ),
    ...overrides,
  };
  await repository.save(review);
  return review;
}

describe("replyToReviewUsecase", () => {
  test("agent reply on open moves the review to replied and appends the entry", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await seedReview(repository, { status: "open" });
    const usecase = replyToReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase({ id: "r1", author: "agent", body: "done" });
    expect(result.isOk()).toBe(true);
    const updated = result._unsafeUnwrap();
    expect(updated.status).toBe("replied");
    expect(updated.thread).toHaveLength(2);
    expect(await repository.get("r1")).toEqual(updated);
    expect(events.events).toEqual([{ type: "review", event: "replied", review: updated }]);
  });

  test("returns not_found for an unknown id", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const usecase = replyToReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-01T00:00:00.000Z"),
    });

    const result = await usecase({ id: "missing", author: "user", body: "x" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("not_found");
  });

  test("propagates the domain not_repliable error and does not save or emit", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await seedReview(repository, { status: "resolved" });
    const usecase = replyToReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase({ id: "r1", author: "agent", body: "x" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("not_repliable");
    expect((await repository.get("r1"))?.status).toBe("resolved");
    expect(events.events).toEqual([]);
  });
});
