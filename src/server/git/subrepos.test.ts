import { execFile } from "node:child_process";
import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { invalidateSubReposCache, listSubRepos } from "./subrepos";
import { invalidateWorktreesCache } from "./worktrees";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(prefix = "herdr-web-subrepos-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
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
  invalidateSubReposCache();
  invalidateWorktreesCache();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listSubRepos", () => {
  test("just the root when there are no submodules or vcstool entries", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");

    const repos = await listSubRepos(dir);
    expect(repos).toEqual([
      {
        id: "",
        name: expect.any(String),
        root: dir,
        kind: "root",
        worktrees: [{ root: dir, branch: "main", head: expect.any(String), isMain: true }],
      },
    ]);
  });

  test("a submodule entry carries its own worktree list, not the parent's", async () => {
    const upstream = await makeRepo("herdr-web-subrepos-upstream-");
    await commit(upstream, "lib.txt", "lib\n");

    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    await execFileP(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "vendor/lib"],
      { cwd: dir },
    );
    await execFileP("git", ["commit", "-q", "-m", "add submodule"], { cwd: dir });

    const repos = await listSubRepos(dir);
    const submodule = repos.find((r) => r.id === "vendor/lib");
    expect(submodule?.worktrees).toEqual([
      { root: submodule!.root, branch: "main", head: expect.any(String), isMain: true },
    ]);
  });

  test("lists an initialized submodule but not an uninitialized one", async () => {
    const upstream = await makeRepo("herdr-web-subrepos-upstream-");
    await commit(upstream, "lib.txt", "lib\n");

    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");
    await execFileP(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "vendor/lib"],
      { cwd: dir },
    );
    await execFileP("git", ["commit", "-q", "-m", "add submodule"], { cwd: dir });

    // A second submodule entry registered in .gitmodules but never
    // `submodule update --init`-ed: git submodule status prefixes it `-`.
    await execFileP(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "vendor/lib2"],
      { cwd: dir },
    );
    await execFileP("git", ["commit", "-q", "-m", "add second submodule"], { cwd: dir });
    await execFileP("git", ["submodule", "deinit", "-q", "--force", "vendor/lib2"], { cwd: dir });

    const repos = await listSubRepos(dir);
    expect(repos.map((r) => ({ id: r.id, kind: r.kind }))).toEqual([
      { id: "", kind: "root" },
      { id: "vendor/lib", kind: "submodule" },
    ]);
    const submodule = repos.find((r) => r.id === "vendor/lib");
    expect(submodule?.root).toBe(await realpathAsync(join(dir, "vendor/lib")));
    expect(submodule?.name).toBe("lib");
  });
});
