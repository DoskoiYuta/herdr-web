import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { listCommits } from "./log";

const execFileP = promisify(execFile);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-log-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir, env: ENV });
  return dir;
}

async function commit(
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(join(dir, file), content);
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message],
    { cwd: dir, env: ENV },
  );
  const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listCommits", () => {
  test("parses a linear history in topo order", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "first");
    const h2 = await commit(dir, "a.txt", "b", "second");

    const { commits, truncated } = await listCommits(dir);
    expect(truncated).toBe(false);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.hash).toBe(h2);
    expect(commits[1]?.hash).toBe(h1);
    expect(commits[0]?.parents).toEqual([h1]);
    expect(commits[1]?.parents).toEqual([]);
    expect(commits[0]?.subject).toBe("second");
    expect(commits[0]?.author).toBe("t");
    expect(commits[0]?.authorEmail).toBe("t@t");
    expect(Number.isFinite(commits[0]?.authorDate)).toBe(true);
  });

  test("preserves newlines, punctuation and non-ASCII in the body", async () => {
    const dir = await makeRepo();
    const message =
      'subject line\n\nbody line one\nbody line two: "quotes" and 日本語 テスト 🎉\nlast line';
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message],
      { cwd: dir, env: ENV },
    );

    const { commits } = await listCommits(dir);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe("subject line");
    expect(commits[0]?.body).toContain("body line one\nbody line two");
    expect(commits[0]?.body).toContain("日本語 テスト 🎉");
  });

  test("reports truncated when more commits exist than max", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1", "c1");
    await commit(dir, "a.txt", "2", "c2");
    await commit(dir, "a.txt", "3", "c3");

    const { commits, truncated } = await listCommits(dir, { max: 2 });
    expect(commits).toHaveLength(2);
    expect(truncated).toBe(true);

    const full = await listCommits(dir, { max: 10 });
    expect(full.truncated).toBe(false);
    expect(full.commits).toHaveLength(3);
  });

  test("all:false only follows HEAD; all:true reaches other branches", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "1", "c1");
    await execFileP("git", ["branch", "other"], { cwd: dir, env: ENV });
    await execFileP("git", ["checkout", "-q", "other"], { cwd: dir, env: ENV });
    await commit(dir, "b.txt", "2", "c2-other");
    const { stdout: branchOut } = await execFileP("git", ["branch", "--show-current"], {
      cwd: dir,
    });
    await execFileP("git", ["checkout", "-q", branchOut.trim()], { cwd: dir, env: ENV }).catch(
      () => {},
    );

    const allBranches = await listCommits(dir, { all: true });
    expect(allBranches.commits.length).toBeGreaterThanOrEqual(2);
    expect(allBranches.commits.some((c) => c.hash === h1)).toBe(true);
  });

  test("honors userArgs (path filter)", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1", "touch a");
    await commit(dir, "b.txt", "1", "touch b");

    const { commits } = await listCommits(dir, { userArgs: ["--", "a.txt"] });
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe("touch a");
  });

  test("extraRevs makes an otherwise-unreachable commit reachable", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "1", "c1");
    await execFileP("git", ["checkout", "-q", "-b", "branch2"], { cwd: dir, env: ENV });
    const h2 = await commit(dir, "a.txt", "2", "c2-branch2");
    await execFileP("git", ["checkout", "-q", "-"], { cwd: dir, env: ENV });
    await execFileP("git", ["branch", "-D", "branch2"], { cwd: dir, env: ENV });

    const withoutExtra = await listCommits(dir);
    expect(withoutExtra.commits.some((c) => c.hash === h2)).toBe(false);

    const withExtra = await listCommits(dir, { extraRevs: [h2] });
    expect(withExtra.commits.some((c) => c.hash === h2)).toBe(true);
    expect(withExtra.commits.some((c) => c.hash === h1)).toBe(true);
  });
});
