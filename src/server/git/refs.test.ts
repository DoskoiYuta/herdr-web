import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { listRefs } from "./refs";

const execFileP = promisify(execFile);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-refs-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir, env: ENV });
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

describe("listRefs", () => {
  test("finds the current branch and marks it isHead", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "init");

    const { refs, head, stashes } = await listRefs(dir);
    expect(head.detached).toBe(false);
    expect(head.branch).toBe("main");
    expect(head.hash).toBe(h1);
    expect(stashes).toEqual([]);

    const mainRef = refs.find((r) => r.type === "head" && r.name === "main");
    expect(mainRef?.hash).toBe(h1);
    expect(mainRef?.isHead).toBe(true);
    expect(mainRef?.fullName).toBe("refs/heads/main");
  });

  test("peels an annotated tag to its target commit, keeps a lightweight tag as-is", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "init");
    await execFileP(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "tag", "-a", "v1", "-m", "v1 tag"],
      { cwd: dir, env: ENV },
    );
    await execFileP("git", ["tag", "lw1"], { cwd: dir, env: ENV });

    const { refs } = await listRefs(dir);
    const annotated = refs.find((r) => r.type === "tag" && r.name === "v1");
    const lightweight = refs.find((r) => r.type === "tag" && r.name === "lw1");
    expect(annotated?.hash).toBe(h1);
    expect(lightweight?.hash).toBe(h1);
  });

  test("reports detached HEAD with no branch", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "init");
    await commit(dir, "a.txt", "b", "second");
    await execFileP("git", ["checkout", "-q", h1], { cwd: dir, env: ENV });

    const { head } = await listRefs(dir);
    expect(head.detached).toBe(true);
    expect(head.branch).toBeUndefined();
    expect(head.hash).toBe(h1);
  });

  test("lists stashes and excludes refs/stash from refs[]", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a", "init");
    await writeFile(join(dir, "a.txt"), "changed");
    await execFileP(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "stash", "push", "-q", "-m", "wip"],
      { cwd: dir, env: ENV },
    );

    const { refs, stashes } = await listRefs(dir);
    expect(stashes).toHaveLength(1);
    expect(stashes[0]?.selector).toBe("stash@{0}");
    expect(stashes[0]?.subject).toContain("wip");
    expect(stashes[0]?.hash).toHaveLength(40);
    expect(refs.some((r) => r.fullName === "refs/stash")).toBe(false);
  });

  test("on an unborn branch (no commits yet) does not throw", async () => {
    const dir = await makeRepo();
    const { refs, head, stashes } = await listRefs(dir);
    expect(head.hash).toBe("");
    expect(head.detached).toBe(false);
    expect(head.branch).toBe("main");
    expect(refs).toEqual([]);
    expect(stashes).toEqual([]);
  });
});
