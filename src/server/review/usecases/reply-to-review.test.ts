import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { createReview, send } from "../domain/transitions";
import { replyToReviewUsecase } from "./reply-to-review";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };

/** agent が返信できるのは送信済みメッセージが 1 件でもある review だけ — send() 済みで seed する */
async function seedReview(
  repository: FakeReviewRepository,
  overrides: Partial<Review> = {},
): Promise<Review> {
  const clock = new ManualClock("2026-01-01T00:00:00.000Z");
  const created = createReview(
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
  );
  const sent = send(created, clock)._unsafeUnwrap();
  const review = { ...sent, ...overrides };
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

  // Without this: a user reply would be indistinguishable from a sent message,
  // so it would notify/appear to the agent before the user hits "send".
  test("user reply appends a draft entry without changing status", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    await seedReview(repository, { status: "open" });
    const usecase = replyToReviewUsecase({
      repository,
      events,
      clock: new ManualClock("2026-01-02T00:00:00.000Z"),
    });

    const result = await usecase({ id: "r1", author: "user", body: "follow-up" });
    expect(result.isOk()).toBe(true);
    const updated = result._unsafeUnwrap();
    expect(updated.status).toBe("open");
    expect(updated.thread.at(-1)).toMatchObject({ author: "user", body: "follow-up", draft: true });
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
