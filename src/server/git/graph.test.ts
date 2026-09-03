import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { buildGraph } from "./graph";

const execFileP = promisify(execFile);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-graph-test-"));
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

describe("buildGraph", () => {
  test("returns commits/refs/head/stashes and no UNCOMMITTED entry for a clean repo", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "init");

    const graph = await buildGraph({ cwd: dir, repo: "" });
    expect(graph.repo).toBe("");
    expect(graph.hasUncommitted).toBe(false);
    expect(graph.truncated).toBe(false);
    expect(graph.commits).toHaveLength(1);
    expect(graph.commits[0]?.hash).toBe(h1);
    expect(graph.head.hash).toBe(h1);
    expect(graph.refs.some((r) => r.name === "main")).toBe(true);
    expect(graph.stashes).toEqual([]);
  });

  test("prepends an UNCOMMITTED pseudo-commit whose parent is HEAD when the worktree is dirty", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a", "init");
    await writeFile(join(dir, "a.txt"), "changed");

    const graph = await buildGraph({ cwd: dir, repo: "" });
    expect(graph.hasUncommitted).toBe(true);
    expect(graph.commits).toHaveLength(2);
    expect(graph.commits[0]?.hash).toBe("UNCOMMITTED");
    expect(graph.commits[0]?.parents).toEqual([h1]);
    expect(graph.commits[1]?.hash).toBe(h1);
  });

  test("all:false only follows HEAD; all:true reaches other branches", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1", "c1");
    await execFileP("git", ["checkout", "-q", "-b", "other"], { cwd: dir, env: ENV });
    await commit(dir, "b.txt", "1", "c2-other");
    await execFileP("git", ["checkout", "-q", "main"], { cwd: dir, env: ENV });

    const headOnly = await buildGraph({ cwd: dir, repo: "" });
    expect(headOnly.commits).toHaveLength(1);

    const allBranches = await buildGraph({ cwd: dir, repo: "", all: true });
    expect(allBranches.commits).toHaveLength(2);
  });

  test("makes a stash base commit reachable", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a", "init");
    await writeFile(join(dir, "a.txt"), "changed");
    await execFileP(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "stash", "push", "-q", "-m", "wip"],
      { cwd: dir, env: ENV },
    );

    const graph = await buildGraph({ cwd: dir, repo: "" });
    expect(graph.stashes).toHaveLength(1);
    expect(graph.commits.some((c) => c.hash === graph.stashes[0]?.hash)).toBe(true);
    expect(graph.hasUncommitted).toBe(false);
  });

  test("reports truncated when max is smaller than the history", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1", "c1");
    await commit(dir, "a.txt", "2", "c2");
    await commit(dir, "a.txt", "3", "c3");

    const graph = await buildGraph({ cwd: dir, repo: "", max: 2 });
    expect(graph.truncated).toBe(true);
    expect(graph.commits).toHaveLength(2);
  });

  test("on an unborn branch (no commits) returns an empty, non-throwing graph", async () => {
    const dir = await makeRepo();
    const graph = await buildGraph({ cwd: dir, repo: "" });
    expect(graph.commits).toEqual([]);
    expect(graph.hasUncommitted).toBe(false);
    expect(graph.head.hash).toBe("");
  });
});
