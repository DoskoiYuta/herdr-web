import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { createFetchRunner, FetchBusyError } from "./fetch";

const execFileP = promisify(execFile);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const dirs: string[] = [];

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileP("git", args, { cwd, env: ENV });
}

async function makeSourceRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-fetch-src-"));
  dirs.push(dir);
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.name", "t"], dir);
  await git(["config", "user.email", "t@t"], dir);
  await writeFile(join(dir, "a.txt"), "a");
  await git(["add", "."], dir);
  await git(["commit", "-q", "-m", "init"], dir);
  return dir;
}

async function makeBare(sourceDir: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-fetch-bare-"));
  await rm(dir, { recursive: true, force: true }); // clone --bare wants to create the dir itself
  await execFileP("git", ["clone", "-q", "--bare", sourceDir, dir], { env: ENV });
  dirs.push(dir);
  return dir;
}

async function cloneWork(bareDir: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-fetch-work-"));
  await rm(dir, { recursive: true, force: true });
  await execFileP("git", ["clone", "-q", bareDir, dir], { env: ENV });
  dirs.push(dir);
  await git(["config", "user.name", "t"], dir);
  await git(["config", "user.email", "t@t"], dir);
  return dir;
}

async function addCommitAndPush(bareDir: string, msg: string): Promise<void> {
  const tmp = await cloneWork(bareDir);
  await writeFile(join(tmp, `${msg}.txt`), msg);
  await git(["add", "."], tmp);
  await git(["commit", "-q", "-m", msg], tmp);
  await git(["push", "-q", "origin", "HEAD"], tmp);
}

async function revParse(dir: string, rev: string): Promise<string> {
  const { stdout } = await git(["rev-parse", rev], dir);
  return stdout.trim();
}

async function writeFakeGit(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-fetch-fakebin-"));
  dirs.push(dir);
  const path = join(dir, "git");
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("createFetchRunner", () => {
  test("fetch --prune succeeds against a local bare origin and updates refs/remotes/origin/*", async () => {
    const source = await makeSourceRepo();
    const bare = await makeBare(source);
    const work = await cloneWork(bare);
    await addCommitAndPush(bare, "c2");

    const runner = createFetchRunner();
    const result = await runner.fetch(work);

    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    // fetch alone must not move the local branch.
    expect(await revParse(work, "main")).toBe(await revParse(source, "main"));
    expect(await revParse(work, "origin/main")).toBe(await revParse(bare, "main"));
  });

  test("fetch against a nonexistent remote fails with nonzero code and stderr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-web-fetch-noremote-"));
    dirs.push(dir);
    await git(["init", "-q", "-b", "main"], dir);
    await git(
      ["remote", "add", "origin", join(tmpdir(), `herdr-web-fetch-does-not-exist-${Date.now()}`)],
      dir,
    );

    const runner = createFetchRunner();
    const result = await runner.fetch(dir);

    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
  });

  test("a second concurrent fetch for the same root rejects with FetchBusyError", async () => {
    const fakeBin = await writeFakeGit("#!/bin/sh\nsleep 0.2\n");
    const work = await mkdtemp(join(tmpdir(), "herdr-web-fetch-busy-"));
    dirs.push(work);

    const runner = createFetchRunner({ bin: fakeBin, timeoutMs: 5000 });
    const first = runner.fetch(work);
    await expect(runner.fetch(work)).rejects.toThrow(FetchBusyError);

    const firstResult = await first;
    expect(firstResult.code).toBe(0);

    // lock released afterwards
    const third = await runner.fetch(work);
    expect(third.code).toBe(0);
  });

  test("a timed-out fetch resolves with code -1, timedOut: true, and releases its lock", async () => {
    const fakeBin = await writeFakeGit("#!/bin/sh\nsleep 5\n");
    const work = await mkdtemp(join(tmpdir(), "herdr-web-fetch-timeout-"));
    dirs.push(work);

    const runner = createFetchRunner({ bin: fakeBin, timeoutMs: 100 });
    const result = await runner.fetch(work);

    expect(result.code).toBe(-1);
    expect(result.timedOut).toBe(true);

    // lock must be usable again afterwards
    const second = await runner.fetch(work);
    expect(second.code).toBe(-1);
    expect(second.timedOut).toBe(true);
  });

  test("different roots run concurrently without blocking each other", async () => {
    const fakeBin = await writeFakeGit("#!/bin/sh\nsleep 0.5\n");
    const workA = await mkdtemp(join(tmpdir(), "herdr-web-fetch-parA-"));
    const workB = await mkdtemp(join(tmpdir(), "herdr-web-fetch-parB-"));
    dirs.push(workA, workB);

    const runner = createFetchRunner({ bin: fakeBin, timeoutMs: 5000 });
    const start = Date.now();
    const [a, b] = await Promise.all([runner.fetch(workA), runner.fetch(workB)]);
    const elapsed = Date.now() - start;

    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    // ran concurrently, not serialized (each sleeps 500ms; serialized would be >= 1000ms)
    expect(elapsed).toBeLessThan(1400);
  });

  test("GIT_TERMINAL_PROMPT=0 and LC_ALL=C are set in the child env", async () => {
    const fakeBin = await writeFakeGit(
      '#!/bin/sh\necho "GIT_TERMINAL_PROMPT=$GIT_TERMINAL_PROMPT LC_ALL=$LC_ALL"\n',
    );
    const work = await mkdtemp(join(tmpdir(), "herdr-web-fetch-env-"));
    dirs.push(work);

    const runner = createFetchRunner({ bin: fakeBin });
    const result = await runner.fetch(work);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/GIT_TERMINAL_PROMPT=0/);
    expect(result.stdout).toMatch(/LC_ALL=C/);
  });

  test("never throws on a non-zero exit; the error comes back on the result", async () => {
    const fakeBin = await writeFakeGit('#!/bin/sh\necho "boom" >&2\nexit 7\n');
    const work = await mkdtemp(join(tmpdir(), "herdr-web-fetch-exit7-"));
    dirs.push(work);

    const runner = createFetchRunner({ bin: fakeBin });
    const result = await runner.fetch(work);

    expect(result.code).toBe(7);
    expect(result.stderr).toMatch(/boom/);
    expect(result.timedOut).toBe(false);
  });
});
