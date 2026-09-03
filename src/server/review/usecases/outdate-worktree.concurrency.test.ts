import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { createReview } from "../domain/transitions";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import type { ListFilter, ReviewRepository } from "../ports";
import { createLocks } from "./locks";
import { outdateWorktreeUsecase } from "./outdate-worktree";
import { replyToReviewUsecase } from "./reply-to-review";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

function makeReview(): Review {
  return createReview(
    {
      id: "r1",
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
  );
}

/**
 * `list()` captures its snapshot from `inner` immediately (reflecting whatever
 * state exists at call time), but withholds *delivering* that snapshot to the
 * caller until `gate` resolves — giving the test full deterministic control
 * over "outdateWorktree has a stale snapshot in hand, but hasn't acted on it
 * yet" without racing on microtask tick counts.
 */
function listGatedRepository(inner: ReviewRepository, gate: Promise<void>): ReviewRepository {
  return {
    get: (id) => inner.get(id),
    list: async (filter: ListFilter) => {
      const snapshot = await inner.list(filter);
      await gate;
      return snapshot;
    },
    save: (review) => inner.save(review),
    updateNotify: (id, notify) => inner.updateNotify(id, notify),
    upsertRepo: (repo) => inner.upsertRepo(repo),
    getRepo: (key) => inner.getRepo(key),
    listRepos: () => inner.listRepos(),
    moveRepo: (from, to) => inner.moveRepo(from, to),
  };
}

describe("F5: outdateWorktree serializes against concurrent replies", () => {
  // Item 5: outdateWorktree currently lists reviews, then writes each one back
  // from that same (possibly now-stale) snapshot with no lock and no re-get.
  // A reply that lands after the list() snapshot was taken but before
  // outdateWorktree's write must not be silently erased.
  test("a reply that lands between outdateWorktree's list() and its write is not lost", async () => {
    const inner = new FakeReviewRepository();
    await inner.save(makeReview());

    let releaseList: () => void;
    const listGate = new Promise<void>((r) => {
      releaseList = r;
    });
    const outdateRepo = listGatedRepository(inner, listGate);
    const events = new FakeReviewEvents();
    const locks = createLocks();

    const outdateWorktree = outdateWorktreeUsecase({
      repository: outdateRepo,
      clock: CLOCK,
      events,
      locks,
    });
    // The reply goes straight through `inner` — unaffected by outdateWorktree's
    // list gate — simulating an independent concurrent request.
    const replyToReview = replyToReviewUsecase({ repository: inner, events, clock: CLOCK, locks });

    // outdateWorktree's list() snapshot is captured now (pre-reply), but its
    // delivery is withheld until releaseList() is called below.
    const outdatePromise = outdateWorktree({ worktreeRoot: "/repo" });

    // The reply runs to completion in full isolation — nothing else is queued
    // that could interleave with it, since outdateWorktree is fully parked
    // awaiting `listGate`.
    const replyResult = await replyToReview({ id: "r1", author: "user", body: "done" });
    expect(replyResult.isOk()).toBe(true);

    // Only now let outdateWorktree see its (now-stale) snapshot and act on it.
    releaseList!();
    await outdatePromise;

    const final = await inner.get("r1");
    expect(final?.thread.some((e) => e.body === "done")).toBe(true);
  });
});
