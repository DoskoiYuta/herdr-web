import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { FakeGitHistory, FakeReviewRepository } from "../testing/fakes";
import { createReview } from "../domain/transitions";
import { listVisibleUsecase } from "./list-visible";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };
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
    // F9: since is inclusive, so the usecase queries `base~1..HEAD1` (base's parent..HEAD)
    gitHistory.ranges.set("/repo:base~1..HEAD1", ["c1"]);

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { since: "base" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["in-range"]);
  });

  // F9: `since` itself must be included in the visible range, not excluded.
  test("since is inclusive of the since commit itself", async () => {
    await repository.save(
      makeReview({ id: "is-since", target: { kind: "commit", hash: "base" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    // real `git rev-list base~1..HEAD1` naturally includes "base" itself — only its
    // parent (base~1) and older commits are excluded.
    gitHistory.ranges.set("/repo:base~1..HEAD1", ["base"]);

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { since: "base" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["is-since"]);
  });

  // F9: since is the repo's root commit (no parent) -> `since~1` doesn't resolve;
  // fall back to a direct probe of `since` itself so the root-commit case still works.
  test("since at the root commit (no parent) falls back instead of erroring", async () => {
    await repository.save(
      makeReview({ id: "root", target: { kind: "commit", hash: "root" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ranges.set("/repo:root~1..HEAD1", null); // root~1 doesn't resolve
    gitHistory.ranges.set("/repo:root..HEAD1", []); // root itself resolves, range excludes it

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { since: "root" },
    });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["root"]);
  });

  // F9: a genuinely unresolvable `since` rev is reported as invalid_rev, not silently empty.
  test("since with an invalid rev returns invalid_rev", async () => {
    gitHistory.heads.set("/repo", "HEAD1");
    gitHistory.ranges.set("/repo:not-a-rev~1..HEAD1", null);
    gitHistory.ranges.set("/repo:not-a-rev..HEAD1", null);

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({
      repo: "/repo",
      worktreeRoot: "/repo",
      opts: { since: "not-a-rev" },
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("invalid_rev");
  });

  // F9: N reviews sharing one commit hash spawn isAncestor once, not N times.
  test("caches isAncestor per (hash, head) within a single request", async () => {
    await repository.save(
      makeReview({ id: "a", target: { kind: "commit", hash: "shared" }, status: "open" }),
    );
    await repository.save(
      makeReview({ id: "b", target: { kind: "commit", hash: "shared" }, status: "open" }),
    );
    gitHistory.heads.set("/repo", "HEAD1");
    let calls = 0;
    const realIsAncestor = gitHistory.isAncestor.bind(gitHistory);
    gitHistory.isAncestor = async (root, ancestor, descendant) => {
      calls++;
      return realIsAncestor(root, ancestor, descendant);
    };
    gitHistory.ancestryOf.set("shared", new Set(["HEAD1"]));

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({ repo: "/repo", worktreeRoot: "/repo" });
    expect(
      result
        ._unsafeUnwrap()
        .map((r) => r.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(calls).toBe(1);
  });

  // F6: a deleted worktree root resolves headOf -> null; only worktree-bound reviews remain.
  test("missing worktree root (headOf null) returns only worktree-bound reviews", async () => {
    await repository.save(makeReview({ id: "wt", worktreeRoot: "/repo", status: "open" }));
    await repository.save(
      makeReview({ id: "commit1", target: { kind: "commit", hash: "c1" }, status: "open" }),
    );
    // no gitHistory.heads entry for "/repo" -> headOf resolves null

    const usecase = listVisibleUsecase({ repository, gitHistory });
    const result = await usecase({ repo: "/repo", worktreeRoot: "/repo" });
    expect(result._unsafeUnwrap().map((r) => r.id)).toEqual(["wt"]);
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
