import { execFile } from "node:child_process";
import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { invalidate, resolveWorktree } from "./resolve";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-resolve-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return realpathAsync(dir);
}

async function commit(dir: string, file: string, content: string): Promise<string> {
  await writeFile(join(dir, file), content);
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", "c"], { cwd: dir });
  const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveWorktree", () => {
  test("null for a path outside any git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-web-resolve-noise-"));
    dirs.push(dir);
    expect(await resolveWorktree(dir)).toBeNull();
  });

  test("resolves root/commonDir/head/branch/rootCommit for a normal repo", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a\n");

    const info = await resolveWorktree(dir);
    expect(info).not.toBeNull();
    expect(info?.root).toBe(dir);
    expect(info?.branch).toBe("main");
    expect(info?.head).toBe(h1);
    expect(info?.rootCommit).toBe(h1);
    expect(info?.isMain).toBe(true);
    expect(info?.commonDir.endsWith(".git")).toBe(true);
  });

  test("resolves from a subdirectory to the same root", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    await mkdir(join(dir, "sub"));

    const info = await resolveWorktree(join(dir, "sub"));
    expect(info?.root).toBe(dir);
  });

  test("null branch and null rootCommit on an unborn branch", async () => {
    const dir = await makeRepo();
    const info = await resolveWorktree(dir);
    expect(info?.head).toBeNull();
    expect(info?.rootCommit).toBeNull();
  });

  test("isMain is false for a linked worktree, and its commonDir matches the main repo's", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    const wtParent = await mkdtemp(join(tmpdir(), "herdr-web-resolve-wt-"));
    dirs.push(wtParent);
    const wtPath = join(wtParent, "wt");
    await execFileP("git", ["worktree", "add", "-q", "-b", "feature", wtPath], { cwd: dir });

    const mainInfo = await resolveWorktree(dir);
    const wtInfo = await resolveWorktree(wtPath);
    expect(mainInfo?.isMain).toBe(true);
    expect(wtInfo?.isMain).toBe(false);
    expect(wtInfo?.commonDir).toBe(mainInfo?.commonDir);
    expect(wtInfo?.branch).toBe("feature");
  });

  test("caches by exact path; invalidate forces a re-resolve reflecting new state", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a\n");

    const first = await resolveWorktree(dir);
    expect(first?.head).toBe(h1);

    const h2 = await commit(dir, "a.txt", "b\n");
    const cachedAgain = await resolveWorktree(dir);
    expect(cachedAgain?.head).toBe(h1); // still cached, stale on purpose

    invalidate(dir);
    const fresh = await resolveWorktree(dir);
    expect(fresh?.head).toBe(h2);
  });
});
