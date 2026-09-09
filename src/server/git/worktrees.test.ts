import { execFile } from "node:child_process";
import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { invalidateWorktreesCache, listWorktrees } from "./worktrees";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(prefix = "herdr-web-worktrees-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return realpathAsync(dir);
}

async function commit(dir: string, file: string, content: string): Promise<void> {
  await writeFile(join(dir, file), content);
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", "c"], { cwd: dir });
}

afterEach(async () => {
  invalidateWorktreesCache();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listWorktrees", () => {
  test("a repo with only the main worktree", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");

    const worktrees = await listWorktrees(dir);
    expect(worktrees).toEqual([
      { root: dir, branch: "main", head: expect.any(String), isMain: true },
    ]);
  });

  test("lists a linked worktree with its own branch, and marks the main one isMain", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    const linkedRaw = join(tmpdir(), `herdr-web-worktrees-linked-${Date.now()}`);
    dirs.push(linkedRaw);
    await execFileP("git", ["worktree", "add", "-q", "-b", "feature", linkedRaw], { cwd: dir });
    const linked = await realpathAsync(linkedRaw);

    const worktrees = await listWorktrees(dir);
    expect(worktrees.map((w) => ({ root: w.root, branch: w.branch, isMain: w.isMain }))).toEqual([
      { root: dir, branch: "main", isMain: true },
      { root: linked, branch: "feature", isMain: false },
    ]);
  });

  test("a detached-HEAD linked worktree has a null branch", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    const linkedRaw = join(tmpdir(), `herdr-web-worktrees-detached-${Date.now()}`);
    dirs.push(linkedRaw);
    await execFileP("git", ["worktree", "add", "-q", "--detach", linkedRaw, "main"], { cwd: dir });

    const worktrees = await listWorktrees(dir);
    const detached = worktrees.find((w) => w.root !== dir);
    expect(detached?.branch).toBeNull();
  });

  test("caches results for repeated calls within the TTL", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");

    const first = await listWorktrees(dir);
    const linkedRaw = join(tmpdir(), `herdr-web-worktrees-cache-${Date.now()}`);
    dirs.push(linkedRaw);
    await execFileP("git", ["worktree", "add", "-q", "-b", "feature", linkedRaw], { cwd: dir });

    const second = await listWorktrees(dir);
    expect(second).toEqual(first);

    invalidateWorktreesCache();
    const third = await listWorktrees(dir);
    expect(third.length).toBe(2);
  });

  // 無いと壊れる: linked worktree から呼ぶと main エントリの gitdir-path クイズが
  // 「呼び出し元 (= linked worktree) の toplevel」に置き換わり、main と linked が
  // 同じ root を指す重複エントリになる。
  test("a submodule's linked worktree, called from the linked worktree itself, doesn't duplicate the main entry", async () => {
    const upstream = await makeRepo("herdr-web-worktrees-upstream-");
    await commit(upstream, "lib.txt", "lib\n");

    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    await execFileP(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "vendor/lib"],
      { cwd: dir },
    );
    await execFileP("git", ["commit", "-q", "-m", "add submodule"], { cwd: dir });

    const subRoot = await realpathAsync(join(dir, "vendor/lib"));
    const linkedRaw = join(tmpdir(), `herdr-web-worktrees-sub-linked-${Date.now()}`);
    dirs.push(linkedRaw);
    await execFileP("git", ["worktree", "add", "-q", "-b", "feature", linkedRaw], { cwd: subRoot });
    const linked = await realpathAsync(linkedRaw);

    const worktrees = await listWorktrees(linked);
    expect(worktrees.map((w) => ({ root: w.root, branch: w.branch, isMain: w.isMain }))).toEqual([
      { root: subRoot, branch: "main", isMain: true },
      { root: linked, branch: "feature", isMain: false },
    ]);
  });
});
