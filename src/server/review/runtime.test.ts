import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../contract/review";
import { openDb, type Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import {
  FakeGitHistory,
  FakeIntroducingCommitFinder,
  FakeWorktreeFileReader,
  ManualClock,
  ManualTimer,
} from "./testing/fakes";
import { createReviewRuntime } from "./runtime";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

function build() {
  const db: Db = openDb(":memory:");
  applyMigrations(db);
  const gitHistory = new FakeGitHistory();
  const finder = new FakeIntroducingCommitFinder();
  const fileReader = new FakeWorktreeFileReader();
  const events: unknown[] = [];

  const runtime = createReviewRuntime({
    config: { notify: { template: "{count} 件", debounceMs: 10_000 } },
    db,
    gitHistory,
    finder,
    fileReader,
    clock: new ManualClock("2026-01-01T00:00:00.000Z"),
    timer: new ManualTimer(),
    onEvent: (e) => events.push(e),
  });

  return { runtime, gitHistory, finder, fileReader, events };
}

describe("createReviewRuntime", () => {
  // F3: creating against a stale createdAtHead is commit-bound immediately via the
  // afterCreate hook wired to reanchorAfterChange, without waiting for repo-changed.
  test("afterCreate commit-binds a review whose createdAtHead is already stale", async () => {
    const { runtime, gitHistory, finder, fileReader } = build();
    gitHistory.heads.set("/repo", "head1"); // HEAD already moved past createdAtHead
    fileReader.files.set(fileReader.keyFor("/repo", "a.ts"), ["x"]); // anchor still present
    // the generated review id isn't known ahead of time, so stub find() to record any call
    let findCalls = 0;
    finder.find = async () => {
      findCalls++;
      return "commit1";
    };

    const result = await runtime.routes.createReview({
      repo: "/repo/.git",
      worktreeRoot: "/repo",
      target: { kind: "worktree", root: "/repo" },
      path: "a.ts",
      anchor: ANCHOR,
      createdAtHead: "stale-head",
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "why?",
    });

    const review = result._unsafeUnwrap();
    const stored = await runtime.repository.get(review.id);
    expect(findCalls).toBeGreaterThan(0);
    expect(stored?.target).toEqual({ kind: "commit", hash: "commit1" });
  });

  // F6: outdateWorktree is exposed off the runtime for bootstrap.ts to trigger.
  test("exposes outdateWorktree", async () => {
    const { runtime } = build();
    const created = await runtime.routes.createReview({
      repo: "/repo/.git",
      worktreeRoot: "/repo",
      target: { kind: "worktree", root: "/repo" },
      path: "a.ts",
      anchor: ANCHOR,
      createdAtHead: "head0",
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "why?",
    });
    const review = created._unsafeUnwrap();

    const changed = (await runtime.outdateWorktree({ worktreeRoot: "/repo" }))._unsafeUnwrap();
    expect(changed.map((r) => r.id)).toEqual([review.id]);
    expect((await runtime.repository.get(review.id))?.status).toBe("outdated");
  });
});
