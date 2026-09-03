import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { createReview } from "../domain/transitions";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { outdateWorktreeUsecase } from "./outdate-worktree";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: overrides.id ?? "r1",
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
    ),
    ...overrides,
  };
}

describe("outdateWorktreeUsecase", () => {
  test("marks every open/replied worktree-bound review on the root outdated and emits outdated", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await repository.save(makeReview({ id: "open1", status: "open" }));
    await repository.save(makeReview({ id: "replied1", status: "replied" }));
    await repository.save(makeReview({ id: "already-resolved", status: "resolved" }));
    await repository.save(makeReview({ id: "already-outdated", status: "outdated" }));

    const usecase = outdateWorktreeUsecase({ repository, clock: CLOCK, events });
    const changed = (await usecase({ worktreeRoot: "/repo" }))._unsafeUnwrap();

    expect(changed.map((r) => r.id).sort()).toEqual(["open1", "replied1"]);
    expect((await repository.get("open1"))?.status).toBe("outdated");
    expect((await repository.get("replied1"))?.status).toBe("outdated");
    expect((await repository.get("already-resolved"))?.status).toBe("resolved");
    const outdatedEvents = events.events.filter(
      (e) => e.type === "review" && e.event === "outdated",
    );
    expect(outdatedEvents).toHaveLength(2);
  });

  test("commit-bound reviews on the same worktreeRoot are left untouched", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await repository.save(
      makeReview({ id: "committed", target: { kind: "commit", hash: "c1" }, status: "open" }),
    );

    const usecase = outdateWorktreeUsecase({ repository, clock: CLOCK, events });
    const changed = (await usecase({ worktreeRoot: "/repo" }))._unsafeUnwrap();

    expect(changed).toHaveLength(0);
    expect((await repository.get("committed"))?.status).toBe("open");
  });

  test("a different worktree root is unaffected", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await repository.save(makeReview({ id: "elsewhere", worktreeRoot: "/other" }));

    const usecase = outdateWorktreeUsecase({ repository, clock: CLOCK, events });
    const changed = (await usecase({ worktreeRoot: "/repo" }))._unsafeUnwrap();

    expect(changed).toHaveLength(0);
    expect((await repository.get("elsewhere"))?.status).toBe("open");
  });
});
