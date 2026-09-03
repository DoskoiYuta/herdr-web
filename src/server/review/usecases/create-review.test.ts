import { describe, expect, test } from "bun:test";
import type { Anchor, CreateReviewRequest } from "../../../contract/review";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { createReviewUsecase } from "./create-review";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

function makeInput(overrides: Partial<CreateReviewRequest> = {}): CreateReviewRequest {
  return {
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    target: { kind: "worktree", root: "/repo" },
    path: "a.ts",
    anchor: ANCHOR,
    createdAtHead: "head1",
    viewedAs: { from: "WORKTREE", to: "WORKTREE" },
    body: "why?",
    ...overrides,
  };
}

describe("createReviewUsecase", () => {
  test("saves the review, registers the repo, emits created, and schedules a notification", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    const scheduled: string[] = [];
    let idCounter = 0;

    const usecase = createReviewUsecase({
      repository,
      events,
      clock,
      scheduleNotify: (review) => scheduled.push(review.id),
      generateId: () => `id-${++idCounter}`,
    });

    const result = await usecase(makeInput());
    expect(result.isOk()).toBe(true);
    const review = result._unsafeUnwrap();
    expect(review.id).toBe("id-1");
    expect(review.status).toBe("open");

    expect(await repository.get(review.id)).toEqual(review);
    expect(await repository.getRepo("/repo/.git")).toMatchObject({
      key: "/repo/.git",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    expect(events.events).toEqual([{ type: "review", event: "created", review }]);
    expect(scheduled).toEqual([review.id]);
  });

  test("keeps firstSeenAt and updates lastSeenAt when the repo already exists", async () => {
    const repository = new FakeReviewRepository();
    await repository.upsertRepo({
      key: "/repo/.git",
      rootCommit: "root1",
      name: "custom-name",
      firstSeenAt: "2020-01-01T00:00:00.000Z",
      lastSeenAt: "2020-01-01T00:00:00.000Z",
    });
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-02-01T00:00:00.000Z");

    const usecase = createReviewUsecase({
      repository,
      events,
      clock,
      scheduleNotify: () => {},
      generateId: () => "id-1",
    });

    await usecase(makeInput());

    expect(await repository.getRepo("/repo/.git")).toEqual({
      key: "/repo/.git",
      rootCommit: "root1",
      name: "custom-name",
      firstSeenAt: "2020-01-01T00:00:00.000Z",
      lastSeenAt: "2026-02-01T00:00:00.000Z",
    });
  });
});
