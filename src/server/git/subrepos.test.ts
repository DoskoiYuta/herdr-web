import { execFile } from "node:child_process";
import { realpath as realpathAsync } from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { invalidateSubReposCache, listSubRepos } from "./subrepos";

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
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listSubRepos", () => {
  test("just the root when there are no submodules or .repos children", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");

    const repos = await listSubRepos(dir);
    expect(repos).toEqual([{ id: "", name: expect.any(String), root: dir, kind: "root" }]);
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

  test("lists .repos/<child> directories that are their own git worktree roots", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n");

    await mkdir(join(dir, ".repos"), { recursive: true });
    const nested = join(dir, ".repos", "nested-a");
    await mkdir(nested, { recursive: true });
    await execFileP("git", ["init", "-q", "-b", "main"], { cwd: nested });
    await execFileP("git", ["config", "user.name", "Test"], { cwd: nested });
    await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: nested });
    await commit(nested, "b.txt", "b\n");

    // A plain (non-repo) directory under .repos/ should be skipped.
    await mkdir(join(dir, ".repos", "not-a-repo"), { recursive: true });

    const repos = await listSubRepos(dir);
    expect(repos.map((r) => ({ id: r.id, kind: r.kind, name: r.name }))).toEqual([
      { id: "", kind: "root", name: expect.any(String) },
      { id: ".repos/nested-a", kind: "nested", name: "nested-a" },
    ]);
    const child = repos.find((r) => r.id === ".repos/nested-a");
    expect(child?.root).toBe(await realpathAsync(nested));
  });
});
