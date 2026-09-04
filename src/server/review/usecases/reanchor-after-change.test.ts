import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { buildAnchor } from "../domain/anchor";
import {
  FakeGitHistory,
  FakeIntroducingCommitFinder,
  FakeReviewEvents,
  FakeReviewRepository,
  FakeWorktreeFileReader,
  ManualClock,
} from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { reanchorAfterChangeUsecase } from "./reanchor-after-change";

const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");
const ANCHOR: Anchor = buildAnchor(["const a = 1;", "const b = 2;", "const c = 3;"], 1, 1, "new");

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
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
    ),
    ...overrides,
  };
}

let repository: FakeReviewRepository;
let fileReader: FakeWorktreeFileReader;
let finder: FakeIntroducingCommitFinder;
let gitHistory: FakeGitHistory;
let events: FakeReviewEvents;

beforeEach(() => {
  repository = new FakeReviewRepository();
  fileReader = new FakeWorktreeFileReader();
  finder = new FakeIntroducingCommitFinder();
  gitHistory = new FakeGitHistory();
  events = new FakeReviewEvents();
});

function usecase() {
  return reanchorAfterChangeUsecase({
    repository,
    fileReader,
    finder,
    gitHistory,
    clock: CLOCK,
    events,
  });
}

describe("reanchorAfterChange — worktree-bound reviews", () => {
  test("file gone -> outdated", async () => {
    const review = makeReview();
    await repository.save(review);
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), null);

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head0",
    });
    const updated = changed._unsafeUnwrap();
    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("outdated");
    expect((await repository.get("r1"))?.status).toBe("outdated");
    expect(events.events).toEqual([{ type: "review", event: "outdated", review: updated[0]! }]);
  });

  test("line present, uncommitted (HEAD unchanged) -> stays as-is (no change)", async () => {
    const review = makeReview();
    await repository.save(review);
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), [
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
    ]);

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head0",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
    expect((await repository.get("r1"))?.status).toBe("open");
    expect((await repository.get("r1"))?.target).toEqual({ kind: "worktree", root: "/repo" });
  });

  test("line gone (context mismatch) -> outdated", async () => {
    const review = makeReview();
    await repository.save(review);
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), ["totally", "different", "content"]);

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head0",
    });
    expect(changed._unsafeUnwrap()[0]?.status).toBe("outdated");
  });

  test("line present and HEAD advanced, introducing commit found -> reanchored to commit", async () => {
    const review = makeReview();
    await repository.save(review);
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), [
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
    ]);
    finder.results.set(finder.keyFor("/repo", "r1", "head0"), "commit1");

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    const updated = changed._unsafeUnwrap();
    expect(updated).toHaveLength(1);
    expect(updated[0]?.target).toEqual({ kind: "commit", hash: "commit1" });
    expect(updated[0]?.status).toBe("open");
    expect(events.events).toEqual([{ type: "review", event: "reanchored", review: updated[0]! }]);
  });

  test("line present and HEAD advanced, no introducing commit found -> stays worktree-bound", async () => {
    const review = makeReview();
    await repository.save(review);
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), [
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
    ]);
    // no finder result registered -> null

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
    expect((await repository.get("r1"))?.target).toEqual({ kind: "worktree", root: "/repo" });
  });

  test("already outdated reviews are skipped", async () => {
    const review = makeReview({ status: "outdated" });
    await repository.save(review);

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
  });
});

describe("reanchorAfterChange — commit-bound reviews (rebase/squash)", () => {
  test("commit-bound review still reachable from HEAD -> untouched", async () => {
    const review = makeReview({ target: { kind: "commit", hash: "c1" } });
    await repository.save(review);
    gitHistory.ancestryOf.set("c1", new Set(["head1"]));

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
  });

  test("commit unreachable, content match found -> retargeted to the new commit", async () => {
    const review = makeReview({ target: { kind: "commit", hash: "c1" }, createdAtHead: "head0" });
    await repository.save(review);
    finder.results.set(finder.keyFor("/repo", "r1", "head0"), "c2");
    // c1 was reachable from this worktree's own previous HEAD (F2): it's ours to rebase-detect.
    gitHistory.ancestryOf.set("c1", new Set(["head0"]));

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    const updated = changed._unsafeUnwrap();
    expect(updated).toHaveLength(1);
    expect(updated[0]?.target).toEqual({ kind: "commit", hash: "c2" });
    expect(updated[0]?.status).toBe(review.status); // status untouched
  });

  test("commit unreachable, no content match -> left as is (surfaced via --unreachable)", async () => {
    const review = makeReview({ target: { kind: "commit", hash: "c1" } });
    await repository.save(review);
    gitHistory.ancestryOf.set("c1", new Set(["head0"]));
    // no finder result -> null

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
    expect((await repository.get("r1"))?.target).toEqual({ kind: "commit", hash: "c1" });
  });

  // Missing-test (a): F2's cell "prevHead non-null, commit unreachable from HEAD
  // AND unreachable from prevHead too" — never ours to rebase-detect, so it must
  // be skipped (left untouched) exactly like the prevHead === null case.
  test("prevHead non-null but commit unreachable from both prevHead and head -> skipped", async () => {
    const review = makeReview({ target: { kind: "commit", hash: "c1" } });
    await repository.save(review);
    // c1 is not reachable from head0 (prevHead) nor head1 (head) — this
    // worktree never had c1 reachable, so a squash/rebase elsewhere is not
    // this worktree's business.
    gitHistory.ancestryOf.set("c1", new Set());

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head1",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
    expect((await repository.get("r1"))?.target).toEqual({ kind: "commit", hash: "c1" });
    // never even asked the finder to look for a content match
    expect(finder.results.size).toBe(0);
  });

  // F6: a status-only tick (prevHead === head, e.g. a dirty-worktree status
  // change with HEAD unmoved) must not run a single isAncestor check per
  // commit-bound review — nothing about their reachability could have changed.
  test("a status-only tick (prevHead === head) skips the commit-bound ancestry loop entirely", async () => {
    const review = makeReview({ target: { kind: "commit", hash: "c1" } });
    await repository.save(review);
    gitHistory.ancestryOf.set("c1", new Set(["head0"]));

    const changed = await usecase()({
      repo: "/repo",
      worktreeRoot: "/repo",
      prevHead: "head0",
      head: "head0",
    });
    expect(changed._unsafeUnwrap()).toHaveLength(0);
    expect(gitHistory.isAncestorCalls).toBe(0);
  });
});
