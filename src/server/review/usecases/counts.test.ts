import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { createReview } from "../domain/transitions";
import { FakeGitHistory, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { countsUsecase } from "./counts";
import { listVisibleUsecase } from "./list-visible";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

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

describe("countsUsecase pendingDrafts", () => {
  // without this test, a commit-bound review created from another worktree would
  // never count toward pendingDrafts at a worktree that can actually send it,
  // leaving the send button showing 0 there.
  test("counts a draft on a commit-bound review created elsewhere but reachable from this worktree", async () => {
    const review = makeReview({
      id: "commit-review",
      worktreeRoot: "/a",
      target: { kind: "commit", hash: "c1" },
    });
    await repository.save(review);
    gitHistory.heads.set("/b", "HEAD-b");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD-b"]));

    const counts = countsUsecase({
      repository,
      listVisible: listVisibleUsecase({ repository, gitHistory }),
    });
    const result = await counts({ repo: "/repo", worktree: "/b" });

    expect(result._unsafeUnwrap().pendingDrafts).toBe(1);
  });
});

describe("countsUsecase replied", () => {
  // 無いと壊れる: commit 対象の replied レビューは Diff を開いても見えず
  // Graph から辿るしかないので、worktree 対象と一緒くたに数えると Diff の
  // バッジが Graph 分まで含んで過大に出る（逆に Graph 側は何も出ない）。
  test("counts worktree-target and commit-target replied reviews separately", async () => {
    const repliedThread = [
      { seq: 0, author: "user" as const, body: "why?", at: "t", agentSession: null, draft: false },
    ];
    const repliedWorktree = makeReview({
      id: "replied-worktree",
      status: "replied",
      thread: repliedThread,
    });
    const repliedCommit = makeReview({
      id: "replied-commit",
      status: "replied",
      target: { kind: "commit", hash: "c1" },
      thread: repliedThread,
    });
    const open = makeReview({ id: "open-1", status: "open" });
    await repository.save(repliedWorktree);
    await repository.save(repliedCommit);
    await repository.save(open);
    gitHistory.heads.set("/repo", "HEAD");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD"]));

    const counts = countsUsecase({
      repository,
      listVisible: listVisibleUsecase({ repository, gitHistory }),
    });
    const result = await counts({ repo: "/repo", worktree: "/repo" });

    expect(result._unsafeUnwrap().replied).toEqual({ worktree: 1, commit: 1 });
  });
});
