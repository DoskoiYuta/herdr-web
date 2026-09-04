import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitHistory } from "../adapters/git-history";
import { createGitIntroducingCommitFinder } from "../adapters/git-introducing-commit";
import { createWorktreeFileReader } from "../adapters/worktree-file-reader";
import { buildAnchor } from "../domain/anchor";
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

// F10: a side=new anchor whose file was `git mv`-renamed must follow the rename
// (path updated in place) instead of being marked outdated.
describe("F10: reanchorAfterChange follows renames", () => {
  test("git mv a.txt -> b.txt: the review's path moves and the review stays open", async () => {
    const root = await mkdtemp(join(tmpdir(), "hw-rename-"));
    dirs.push(root);
    await git(root, "init", "-q", "-b", "main");
    const lines = ["one", "two", "three"];
    await writeFile(join(root, "a.txt"), lines.join("\n") + "\n");
    await git(root, "add", ".");
    await git(root, "commit", "-q", "-m", "init");
    const createdAtHead = await git(root, "rev-parse", "HEAD");

    const anchor = buildAnchor(lines, 1, 1, "new"); // anchors "two"
    const clock = new ManualClock("2026-01-01T00:00:00.000Z");
    const review = createReview(
      {
        id: "r1",
        repo: root,
        target: { kind: "worktree", root },
        worktreeRoot: root,
        path: "a.txt",
        anchor,
        createdAtHead,
        viewedAs: { from: "HEAD", to: "WORKTREE" },
        body: "why?",
      },
      clock,
    );
    const repository = new FakeReviewRepository();
    await repository.save(review);
    const events = new FakeReviewEvents();

    // rename, but leave HEAD where it was (the rename is still uncommitted... but
    // renamedPath is computed against HEAD, so commit it to make it observable)
    await exec("git", ["mv", "a.txt", "b.txt"], { cwd: root });
    await git(root, "commit", "-qam", "rename a to b");
    const head = await git(root, "rev-parse", "HEAD");

    const history = createGitHistory();
    const usecase = reanchorAfterChangeUsecase({
      repository,
      fileReader: createWorktreeFileReader(),
      finder: createGitIntroducingCommitFinder(history),
      gitHistory: history,
      clock,
      events,
    });

    const changed = (
      await usecase({ repo: root, worktreeRoot: root, prevHead: createdAtHead, head })
    )._unsafeUnwrap();

    expect(changed).toHaveLength(1);
    const updated = await repository.get("r1");
    expect(updated?.path).toBe("b.txt");
    expect(updated?.status).not.toBe("outdated");
  });
});
