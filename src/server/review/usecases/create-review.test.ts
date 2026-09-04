import { describe, expect, test } from "bun:test";
import type { Anchor, CreateReviewRequest } from "../../../contract/review";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { createReviewUsecase } from "./create-review";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };

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
  test("saves a draft review, registers the repo, and emits created", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    let idCounter = 0;

    const usecase = createReviewUsecase({
      repository,
      events,
      clock,
      generateId: () => `id-${++idCounter}`,
    });

    const result = await usecase(makeInput());
    expect(result.isOk()).toBe(true);
    const review = result._unsafeUnwrap();
    expect(review.id).toBe("id-1");
    expect(review.status).toBe("open");
    expect(review.thread[0]).toMatchObject({ draft: true });
    expect(review.notify.state).toBe("none");

    expect(await repository.get(review.id)).toEqual(review);
    expect(await repository.getRepo("/repo/.git")).toMatchObject({
      key: "/repo/.git",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    expect(events.events).toEqual([{ type: "review", event: "created", review }]);
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

  // F3: a review created against a `createdAtHead` that's already stale (the poller
  // missed a commit, or HEAD moved between the diff being loaded and the POST landing)
  // must be commit-bound immediately, not wait for the next repo-changed tick.
  test("calls afterCreate so a stale createdAtHead is commit-bound immediately", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    const afterCreateCalls: string[] = [];

    const usecase = createReviewUsecase({
      repository,
      events,
      clock,
      generateId: () => "id-1",
      afterCreate: async (review) => {
        afterCreateCalls.push(review.id);
        // simulate what runtime.ts wires: reanchorAfterChange commit-binding it
        await repository.save({
          ...review,
          target: { kind: "commit", hash: "commit-now" },
        });
      },
    });

    const result = await usecase(makeInput({ createdAtHead: "stale-head" }));
    expect(result.isOk()).toBe(true);
    expect(afterCreateCalls).toEqual(["id-1"]);
    expect((await repository.get("id-1"))?.target).toEqual({ kind: "commit", hash: "commit-now" });
  });

  // item 9: afterCreate must run BEFORE `created` is emitted — otherwise clients see
  // a worktree-bound `created` immediately followed by a `reanchored`.
  test("created is emitted with the post-afterCreate final review, not the pre-afterCreate one", async () => {
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    const order: string[] = [];

    const usecase = createReviewUsecase({
      repository,
      events,
      clock,
      generateId: () => "id-1",
      afterCreate: async (review) => {
        order.push("afterCreate");
        await repository.save({ ...review, target: { kind: "commit", hash: "commit-now" } });
      },
    });

    const result = await usecase(makeInput({ createdAtHead: "stale-head" }));
    const review = result._unsafeUnwrap();
    order.push("created-returned");

    expect(order).toEqual(["afterCreate", "created-returned"]);
    expect(events.events).toEqual([{ type: "review", event: "created", review }]);
    // the emitted/returned review reflects the final, commit-bound state
    expect(review.target).toEqual({ kind: "commit", hash: "commit-now" });
    expect((events.events[0] as { review: typeof review }).review.target).toEqual({
      kind: "commit",
      hash: "commit-now",
    });
  });
});
