import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../../contract/review";
import { createReview } from "../domain/transitions";
import {
  FakeAgentNotifier,
  FakeGitHistory,
  FakeReviewEvents,
  FakeReviewRepository,
  ManualClock,
  ManualTimer,
} from "../testing/fakes";
import { listVisibleUsecase } from "./list-visible";
import { createNotifyScheduler } from "./notify-scheduler";
import { sendDraftsUsecase } from "./send-drafts";

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
let events: FakeReviewEvents;
let notifier: FakeAgentNotifier;

beforeEach(() => {
  repository = new FakeReviewRepository();
  gitHistory = new FakeGitHistory();
  events = new FakeReviewEvents();
  notifier = new FakeAgentNotifier();
});

function build() {
  const timer = new ManualTimer();
  const notifyScheduler = createNotifyScheduler({
    notifier,
    events,
    repository,
    clock: CLOCK,
    timer,
    debounceMs: 10_000,
  });
  const listVisible = listVisibleUsecase({ repository, gitHistory });
  const sendDrafts = sendDraftsUsecase({
    repository,
    events,
    clock: CLOCK,
    notifyScheduler,
    notifier,
    listVisible,
  });
  return { sendDrafts, notifyScheduler, timer };
}

describe("sendDraftsUsecase", () => {
  // without this test, a commit-bound review created from another worktree could
  // never be sent from a worktree whose HEAD merely contains the commit — the
  // send button would silently show nothing to send there.
  test("sends a commit-bound review created from another worktree when its commit is reachable from the sending worktree", async () => {
    const review = makeReview({
      id: "commit-review",
      worktreeRoot: "/a",
      target: { kind: "commit", hash: "c1" },
    });
    await repository.save(review);
    gitHistory.heads.set("/b", "HEAD-b");
    gitHistory.ancestryOf.set("c1", new Set(["HEAD-b"]));
    notifier.targets.set("/b", [{ pane: "pane-1", focused: false }]);

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/b" });

    expect(result._unsafeUnwrap().reviews.map((r) => r.id)).toEqual(["commit-review"]);
    expect(notifier.calls).toEqual([
      { worktreeRoot: "/b", reviewIds: ["commit-review"], pane: "pane-1" },
    ]);
  });

  // without this test, sending from a worktree whose HEAD does not contain the
  // commit could send drafts that aren't actually visible there.
  test("leaves the draft of a review whose commit is not reachable from the sending worktree", async () => {
    const review = makeReview({
      id: "unreachable-review",
      worktreeRoot: "/a",
      target: { kind: "commit", hash: "c2" },
    });
    await repository.save(review);
    gitHistory.heads.set("/b", "HEAD-b");
    // no ancestry entry for c2 -> not reachable from /b
    notifier.targets.set("/b", [{ pane: "pane-1", focused: false }]);

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/b" });

    expect(result._unsafeUnwrap().reviews).toEqual([]);
    const saved = await repository.get("unreachable-review");
    expect(saved?.thread.some((e) => e.draft)).toBe(true);
  });

  // without this test, sending could silently mark drafts sent and hand them to
  // notifyScheduler even though there is no agent pane anywhere to notify.
  test("no agent pane at the worktree -> no_agent, drafts left untouched", async () => {
    const review = makeReview({ id: "r1" });
    await repository.save(review);
    // no targets registered for "/repo"

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/repo" });

    expect(result._unsafeUnwrapErr()).toEqual({
      type: "no_agent",
      message: expect.any(String),
    });
    expect(notifier.calls).toHaveLength(0);
    const saved = await repository.get("r1");
    expect(saved?.thread.some((e) => e.draft)).toBe(true);
  });

  // without this test, sending with two agent panes at the worktree and no `pane`
  // could pick one arbitrarily, silently sending the prompt to the wrong agent.
  test("multiple agent panes without a pane -> ambiguous_target listing both, drafts left untouched", async () => {
    const review = makeReview({ id: "r1" });
    await repository.save(review);
    notifier.targets.set("/repo", [
      { pane: "p1", focused: false },
      { pane: "p2", focused: false },
    ]);

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/repo" });

    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("ambiguous_target");
    expect((error as { targets: string[] }).targets.sort()).toEqual(["p1", "p2"]);
    expect(notifier.calls).toHaveLength(0);
    const saved = await repository.get("r1");
    expect(saved?.thread.some((e) => e.draft)).toBe(true);
  });

  // without this test, a `pane` that doesn't belong to the target worktree could
  // silently be forwarded to the notifier instead of being rejected up front.
  test("a pane not among the worktree's targets -> invalid_target, drafts left untouched", async () => {
    const review = makeReview({ id: "r1" });
    await repository.save(review);
    notifier.targets.set("/repo", [{ pane: "p1", focused: false }]);

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/repo", pane: "p2" });

    expect(result._unsafeUnwrapErr().type).toBe("invalid_target");
    expect(notifier.calls).toHaveLength(0);
    const saved = await repository.get("r1");
    expect(saved?.thread.some((e) => e.draft)).toBe(true);
  });

  // without this test, an explicit `pane` chosen by the caller (e.g. because the
  // worktree had multiple agent panes) could be dropped on the way to the notifier.
  test("an explicit pane reaches the notifier as `pane`", async () => {
    const review = makeReview({ id: "r1" });
    await repository.save(review);
    notifier.targets.set("/repo", [
      { pane: "p1", focused: false },
      { pane: "p2", focused: false },
    ]);

    const { sendDrafts } = build();
    const result = await sendDrafts({ repo: "/repo", worktreeRoot: "/repo", pane: "p2" });

    expect(result._unsafeUnwrap().reviews.map((r) => r.id)).toEqual(["r1"]);
    expect(notifier.calls).toEqual([{ worktreeRoot: "/repo", reviewIds: ["r1"], pane: "p2" }]);
  });
});
