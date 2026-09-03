import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Review } from "../../../contract/review";
import { buildAnchor } from "../domain/anchor";
import { createGitHistory } from "./git-history";
import { createGitIntroducingCommitFinder } from "./git-introducing-commit";
import { createWorktreeFileReader } from "./worktree-file-reader";

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

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hw-adapters-"));
  dirs.push(dir);
  await git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function reviewWith(anchor: Review["anchor"], root: string, createdAtHead: string): Review {
  return {
    id: "r1",
    repo: `${root}/.git`,
    target: { kind: "worktree", root },
    worktreeRoot: root,
    path: "a.txt",
    anchor,
    createdAtHead,
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [],
    notify: { state: "none", pane: null, at: null },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("createGitHistory", () => {
  test("headOf / isAncestor / revRange", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const first = await h.headOf(root);
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\nfour\n");
    await git(root, "commit", "-qam", "second");
    const second = await h.headOf(root);
    expect(await h.isAncestor(root, first!, second!)).toBe(true);
    expect(await h.isAncestor(root, second!, first!)).toBe(false);
    expect(await h.isAncestor(root, "0000000000000000000000000000000000000000", second!)).toBe(
      false,
    );
    expect(await h.revRange(root, first!, second!)).toEqual([second!]);
  });

  test("headOf on an unborn branch is null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hw-unborn-"));
    dirs.push(dir);
    await git(dir, "init", "-q");
    expect(await createGitHistory().headOf(dir)).toBeNull();
  });

  // F6: a deleted worktree root must resolve headOf to null, not reject.
  test("headOf on a missing directory resolves null instead of rejecting", async () => {
    const dir = join(tmpdir(), `hw-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await expect(createGitHistory().headOf(dir)).resolves.toBeNull();
  });

  // F9: an invalid `since` rev must be reported distinctly from "empty range".
  test("revRange returns null for an unresolvable `from` rev (F9 invalid_rev)", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const head = (await h.headOf(root))!;
    expect(await h.revRange(root, "not-a-real-rev", head)).toBeNull();
    expect(await h.revRange(root, head, head)).toEqual([]);
  });

  // F10: follow a `git mv` rename so a side=new anchor isn't outdated needlessly.
  test("renamedPath finds the new name of a file renamed since sinceHead", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const since = (await h.headOf(root))!;
    await exec("git", ["mv", "a.txt", "b.txt"], { cwd: root });
    await git(root, "commit", "-qam", "rename a to b");
    expect(await h.renamedPath(root, since, "a.txt")).toBe("b.txt");
    expect(await h.renamedPath(root, since, "nonexistent.txt")).toBeNull();
  });
});

describe("createWorktreeFileReader", () => {
  test("reads lines, returns null for missing or escaping paths", async () => {
    const root = await makeRepo();
    const r = createWorktreeFileReader();
    expect(await r.readLines(root, "a.txt")).toEqual(["one", "two", "three"]);
    expect(await r.readLines(root, "missing.txt")).toBeNull();
    expect(await r.readLines(root, "../etc/passwd")).toBeNull();
    expect(await r.readLines(root, "/etc/passwd")).toBeNull();
  });
});

describe("createGitIntroducingCommitFinder", () => {
  test("side=new: finds the commit that introduced an added line", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const since = (await h.headOf(root))!;
    // 未コミットの追加行にアンカー
    await writeFile(join(root, "a.txt"), "one\ntwo\nnew line\nthree\n");
    const anchor = buildAnchor(["one", "two", "new line", "three"], 2, "new");
    const review = reviewWith(anchor, root, since);
    const finder = createGitIntroducingCommitFinder(h);
    expect(await finder.find(root, review, since)).toBeNull(); // まだコミットされていない
    await git(root, "commit", "-qam", "add line");
    const c = (await h.headOf(root))!;
    expect(await finder.find(root, review, since)).toBe(c);
  });

  test("side=new: a context line that already existed yields null", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const since = (await h.headOf(root))!;
    const anchor = buildAnchor(["one", "two", "three"], 1, "new");
    const review = reviewWith(anchor, root, since);
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\nfour\n");
    await git(root, "commit", "-qam", "unrelated");
    expect(await createGitIntroducingCommitFinder(h).find(root, review, since)).toBeNull();
  });

  test("side=old: finds the commit that deleted the line", async () => {
    const root = await makeRepo();
    const h = createGitHistory();
    const since = (await h.headOf(root))!;
    const anchor = buildAnchor(["one", "two", "three"], 1, "old");
    const review = reviewWith(anchor, root, since);
    await writeFile(join(root, "a.txt"), "one\nthree\n");
    const finder = createGitIntroducingCommitFinder(h);
    expect(await finder.find(root, review, since)).toBeNull();
    await git(root, "commit", "-qam", "delete two");
    const c = (await h.headOf(root))!;
    expect(await finder.find(root, review, since)).toBe(c);
  });
});
