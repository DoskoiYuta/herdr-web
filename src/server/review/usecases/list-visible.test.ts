import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { FakeGitHistory, FakeReviewRepository } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { listVisibleUsecase } from "./list-visible";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: "r",
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
let gitHistory: FakeGitHistory;

beforeEach(() => {
  repository = new FakeReviewRepository();
  gitHistory = new FakeGitHistory();
});

describe("listVisibleUsecase", () => {
  test("default: worktree-bound reviews on this worktree + ancestor commit-bound reviews, open/replied only", async () => {
    await repository.save(makeReview({ id: "wt-here", worktreeRoot: "/repo", status: "open" }));
    await repository.save(
      makeReview({ id: "wt-elsewhere", worktreeRoot: "/other", status: "open" }),
    );
    await repository.save(
      makeReview({
        id: "commit-ancestor",
        target: { kind: "commit", hash: "c1" },
        status: "replied",
      }),
    );
    await repository.save(
      makeReview({
        id: "commit-not-ancestor",
        target: { kind: "commit", hash: "c2" },
        status: "open",
      }),
    );
    await repository.save(
      makeReview({ id: "resolved-hidden", worktreeRoot: "/repo", status: "resolved" }),
    );

    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD1"]));

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({ repo: "/repo", worktreeRoot: "/repo" });
    const ids = result
      ._unsafeUnwrap()
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(["commit-ancestor", "wt-here"]);
  });

  test("all: includes resolved/outdated too", async () => {
    await repository.save(makeReview({ id: "r1", worktreeRoot: "/repo", status: "resolved" }));
    gitHistory.heads.set("/repo", "HEAD1");

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({ repo: "/repo", worktreeRoot: "/repo", opts: { all: true } });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["r1"]);
  });

  test("uncommitted: only worktree-bound reviews on this worktree", async () => {
    await repository.save(makeReview({ id: "wt1", worktreeRoot: "/repo", status: "open" }));
    await repository.save(
      makeReview({ id: "commit1", target: { kind: "commit", hash: "c1" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD1"]));

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { uncommitted: true },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["wt1"]);
  });

  test("commit: only commit-bound reviews for the given commit", async () => {
    await repository.save(
      makeReview({ id: "c1", target: { kind: "commit", hash: "abc" }, status: "open" }),
    );
    await repository.save(
      makeReview({ id: "c2", target: { kind: "commit", hash: "def" }, status: "open" }),
    );
    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { commit: "abc" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["c1"]);
  });

  test("since: restricts commit-bound reviews to commits within since..HEAD", async () => {
    await repository.save(
      makeReview({ id: "in-range", target: { kind: "commit", hash: "c1" }, status: "open" }),
    );
    await repository.save(
      makeReview({ id: "out-of-range", target: { kind: "commit", hash: "c2" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ranges.set("/repo:base..HEAD1", ["c1"]);

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { since: "base" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["in-range"]);
  });

  test("unreachable: commit-bound reviews whose commit is not an ancestor of HEAD", async () => {
    await repository.save(
      makeReview({ id: "reachable", target: { kind: "commit", hash: "c1" }, status: "open" }),
    );
    await repository.save(
      makeReview({ id: "unreachable", target: { kind: "commit", hash: "c2" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD1"]));

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { unreachable: true },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["unreachable"]);
  });

  test("path filters both worktree- and commit-bound reviews", async () => {
    await repository.save(makeReview({ id: "a", worktreeRoot: "/repo", path: "a.ts" }));
    await repository.save(makeReview({ id: "b", worktreeRoot: "/repo", path: "b.ts" }));
    gitHistory.heads.set("/repo", "HEAD1");

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { path: "a.ts" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["a"]);
  });
});
