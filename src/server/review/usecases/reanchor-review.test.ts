import { describe, expect, test } from "bun:test";
import type { Review } from "../../../contract/review";
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
import { reanchorReviewUsecase } from "./reanchor-review";

const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");
const LINES = ["const a = 1;", "const b = 2;", "const c = 3;"];

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: "r1",
        repo: "/repo",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: buildAnchor(LINES, 1, "new"),
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    ),
    ...overrides,
  };
}

function deps() {
  return {
    repository: new FakeReviewRepository(),
    fileReader: new FakeWorktreeFileReader(),
    finder: new FakeIntroducingCommitFinder(),
    gitHistory: new FakeGitHistory(),
    clock: CLOCK,
    events: new FakeReviewEvents(),
  };
}

describe("reanchorReviewUsecase", () => {
  test("not_found for an unknown id", async () => {
    const d = deps();
    const usecase = reanchorReviewUsecase(d);
    const result = await usecase({ id: "missing" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("not_found");
  });

  test("worktree-bound: file gone -> outdated", async () => {
    const d = deps();
    await d.repository.save(makeReview());
    d.fileReader.files.set(d.fileReader.keyFor("/repo", "a.ts"), null);
    const usecase = reanchorReviewUsecase(d);

    const result = await usecase({ id: "r1", head: "head0" });
    expect(result._unsafeUnwrap().status).toBe("outdated");
  });

  test("worktree-bound: line present, head advanced with introducing commit -> commit-bound", async () => {
    const d = deps();
    await d.repository.save(makeReview());
    d.fileReader.files.set(d.fileReader.keyFor("/repo", "a.ts"), LINES);
    d.finder.results.set(d.finder.keyFor("/repo", "r1", "head0"), "commit1");
    const usecase = reanchorReviewUsecase(d);

    const result = await usecase({ id: "r1", head: "head1" });
    expect(result._unsafeUnwrap().target).toEqual({ kind: "commit", hash: "commit1" });
  });

  test("commit-bound: unreachable with content match -> retargeted", async () => {
    const d = deps();
    await d.repository.save(makeReview({ target: { kind: "commit", hash: "old" } }));
    d.finder.results.set(d.finder.keyFor("/repo", "r1", "head0"), "new-commit");
    const usecase = reanchorReviewUsecase(d);

    const result = await usecase({ id: "r1", head: "head1" });
    expect(result._unsafeUnwrap().target).toEqual({ kind: "commit", hash: "new-commit" });
  });

  test("commit-bound: reachable -> untouched", async () => {
    const d = deps();
    await d.repository.save(makeReview({ target: { kind: "commit", hash: "c1" } }));
    d.gitHistory.ancestryOf.set("c1", new Set(["head1"]));
    const usecase = reanchorReviewUsecase(d);

    const result = await usecase({ id: "r1", head: "head1" });
    expect(result._unsafeUnwrap().target).toEqual({ kind: "commit", hash: "c1" });
  });
});
