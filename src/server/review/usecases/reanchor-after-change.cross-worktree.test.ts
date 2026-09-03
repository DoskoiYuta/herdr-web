import { describe, expect, test, afterEach } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitHistory } from "../adapters/git-history";
import { createGitIntroducingCommitFinder } from "../adapters/git-introducing-commit";
import { createWorktreeFileReader } from "../adapters/worktree-file-reader";
import { createReview } from "../domain/transitions";
import { FakeReviewEvents, FakeReviewRepository, ManualClock } from "../testing/fakes";
import { reanchorAfterChangeUsecase } from "./reanchor-after-change";

const exec = promisify(execFile);
const dirs: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * F2: two real worktrees of the same repo. A review is bound to a commit on
 * `feature`. `main`'s worktree squash-merges `feature` (so, from main's point of
 * view, the original commit becomes unreachable — replaced by a squash commit).
 * A repo-changed tick on EITHER worktree must not touch the review, because
 * neither worktree's *own* previous HEAD ever had that commit unreachable-from
 * (main's worktree never had it reachable to begin with; feature's worktree still
 * has it reachable). Before F2, a tick on main's worktree — whose prevHead was
 * being computed as `head` itself — could misjudge "unreachable from new head" and
 * go rebase-detect/retarget a commit that never belonged to main's history.
 */
describe("F2: cross-worktree hijack in the reanchorAfterChange commit loop", () => {
  test("ticks on either worktree leave a feature-branch-bound review on its original commit", async () => {
    const main = await mkdtemp(join(tmpdir(), "hw-cross-main-"));
    dirs.push(main);
    await git(main, "init", "-q", "-b", "main");
    await writeFile(join(main, "a.txt"), "one\ntwo\nthree\n");
    await git(main, "add", ".");
    await git(main, "commit", "-q", "-m", "init");

    await git(main, "worktree", "add", "-q", "-b", "feature", join(main, "wt-feature"));
    const featureRoot = join(main, "wt-feature");

    // commit C on feature — this is what the review is bound to
    await writeFile(join(featureRoot, "a.txt"), "one\ntwo\nthree\nfour\n");
    await git(featureRoot, "commit", "-qam", "add four");
    const commitC = await git(featureRoot, "rev-parse", "HEAD");

    const history = createGitHistory();
    const finder = createGitIntroducingCommitFinder(history);
    const fileReader = createWorktreeFileReader();
    const repository = new FakeReviewRepository();
    const events = new FakeReviewEvents();
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");

    const review = createReview(
      {
        id: "r1",
        repo: main, // commonDir is irrelevant to this test's filter
        target: { kind: "commit", hash: commitC },
        worktreeRoot: featureRoot,
        path: "a.txt",
        anchor: { side: "new", line: "four", before: ["three"], after: [], lineHint: 4, hash: "h" },
        createdAtHead: commitC,
        viewedAs: { from: "HEAD", to: "WORKTREE" },
        body: "why?",
      },
      clock,
    );
    await repository.save(review);

    const usecase = reanchorAfterChangeUsecase({
      repository,
      fileReader,
      finder,
      gitHistory: history,
      clock,
      events,
    });

    const mainHeadBefore = await git(main, "rev-parse", "HEAD");

    // squash-merge feature into main (in main's worktree) — main's HEAD advances
    // to a brand-new commit; commitC is not (and never was) reachable from main.
    await git(main, "merge", "--squash", "feature");
    await git(main, "commit", "-qam", "squash feature");
    const mainHeadAfter = await git(main, "rev-parse", "HEAD");

    // A tick on main's worktree: prevHead is unknown (first observation) -> null.
    await usecase({
      repo: main,
      worktreeRoot: main,
      prevHead: null,
      head: mainHeadAfter,
    });
    expect((await repository.get("r1"))?.target).toEqual({ kind: "commit", hash: commitC });

    // Feature's own worktree hasn't moved at all; a tick there must also leave it alone.
    await usecase({
      repo: main,
      worktreeRoot: featureRoot,
      prevHead: commitC,
      head: commitC,
    });
    expect((await repository.get("r1"))?.target).toEqual({ kind: "commit", hash: commitC });

    // Sanity: main really did move, and commitC really is unreachable from main's new HEAD.
    expect(mainHeadAfter).not.toBe(mainHeadBefore);
    expect(await history.isAncestor(main, commitC, mainHeadAfter)).toBe(false);
  });
});
