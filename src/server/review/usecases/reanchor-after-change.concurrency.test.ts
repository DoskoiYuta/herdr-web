import { describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { createReview } from "../domain/transitions";
import {
  FakeGitHistory,
  FakeIntroducingCommitFinder,
  FakeReviewEvents,
  FakeReviewRepository,
  FakeWorktreeFileReader,
  ManualClock,
} from "../testing/fakes";
import { createLocks } from "./locks";
import { reanchorAfterChangeUsecase } from "./reanchor-after-change";
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

/** A ReviewRepository wrapper whose `save` can be held open by the test until released. */
function gatedRepository(inner: FakeReviewRepository) {
  let gate: Promise<void> | null = null;
  return {
    inner,
    setGate(p: Promise<void> | null) {
      gate = p;
    },
    get: (id: string) => inner.get(id),
    list: inner.list.bind(inner),
    save: async (review: Review) => {
      if (gate) await gate;
      await inner.save(review);
    },
    updateNotify: inner.updateNotify.bind(inner),
    upsertRepo: inner.upsertRepo.bind(inner),
    getRepo: inner.getRepo.bind(inner),
    listRepos: inner.listRepos.bind(inner),
    moveRepo: inner.moveRepo.bind(inner),
  };
}

describe("F4: lost updates", () => {
  test("a reply during a concurrent reanchor is not lost (both land on the final row)", async () => {
    const inner = new FakeReviewRepository();
    await inner.save(makeReview());
    const repository = gatedRepository(inner);
    const fileReader = new FakeWorktreeFileReader();
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), ["x"]);
    const finder = new FakeIntroducingCommitFinder();
    finder.results.set(finder.keyFor("/repo", "r1", "head0"), "commit1");
    const gitHistory = new FakeGitHistory();
    const events = new FakeReviewEvents();
    const locks = createLocks();

    const reanchorAfterChange = reanchorAfterChangeUsecase({
      repository,
      fileReader,
      finder,
      gitHistory,
      clock: CLOCK,
      events,
      locks,
    });
    const replyToReview = replyToReviewUsecase({ repository, events, clock: CLOCK, locks });

    // Hold the reanchor's save open until the reply has had a chance to run and complete.
    let releaseGate: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    repository.setGate(gate);

    const reanchorPromise = reanchorAfterChange({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: null,
      head: "head1",
    });

    // Give the reanchor a tick to reach (and block on) its save via the gate,
    // then start the reply — it must queue behind the review-level lock rather
    // than reading a stale pre-reanchor snapshot.
    await Promise.resolve();
    repository.setGate(null); // the reply's own save should not be gated
    const replyPromise = replyToReview({ id: "r1", author: "agent", body: "done" });

    releaseGate!();
    await Promise.all([reanchorPromise, replyPromise]);

    const final = await inner.get("r1");
    expect(final?.target).toEqual({ kind: "commit", hash: "commit1" });
    expect(final?.thread.some((e) => e.body === "done")).toBe(true);
  });

  test("concurrent double reanchorAfterChange for the same root emits each transition once", async () => {
    const repository = new FakeReviewRepository();
    await repository.save(makeReview());
    const fileReader = new FakeWorktreeFileReader();
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), null); // file gone -> outdated
    const finder = new FakeIntroducingCommitFinder();
    const gitHistory = new FakeGitHistory();
    const events = new FakeReviewEvents();
    const locks = createLocks();

    const reanchorAfterChange = reanchorAfterChangeUsecase({
      repository,
      fileReader,
      finder,
      gitHistory,
      clock: CLOCK,
      events,
      locks,
    });

    const input = { repo: "/repo", worktreeRoot: "/repo", prevHead: null, head: "head0" };
    const [a, b] = await Promise.all([reanchorAfterChange(input), reanchorAfterChange(input)]);

    const outdatedEvents = events.events.filter(
      (e) => e.type === "review" && e.event === "outdated",
    );
    expect(outdatedEvents).toHaveLength(1);
    expect(a._unsafeUnwrap().length + b._unsafeUnwrap().length).toBe(1);
  });
});
