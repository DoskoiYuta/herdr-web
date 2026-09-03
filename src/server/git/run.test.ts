import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import {
  EMPTY_TREE,
  catFileBlob,
  diffPatch,
  getEmptyTree,
  getRepoRoot,
  hasHead,
  listUntracked,
  noIndexPatch,
  runGit,
} from "./run";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-run-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("runGit", () => {
  test("EMPTY_TREE constant", () => {
    expect(EMPTY_TREE).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });

  test("resolves stdout on ok code", async () => {
    const dir = await makeRepo();
    const { stdout, code } = await runGit(["rev-parse", "--show-toplevel"], { cwd: dir });
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test("rejects with stderr in message on bad code", async () => {
    const dir = await makeRepo();
    await expect(runGit(["not-a-real-command"], { cwd: dir })).rejects.toThrow();
  });

  test("prepends core.quotePath=false", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "日本語.txt"), "hi");
    await execFileP("git", ["add", "."], { cwd: dir });
    const { stdout } = await runGit(["status", "--short"], { cwd: dir });
    expect(stdout).toContain("日本語.txt");
  });

  test("forces LC_ALL=C / LANG=C in the child env, even against a caller-supplied opts.env", async () => {
    const dir = await makeRepo();
    const fakeGitPath = join(dir, "fake-git.sh");
    await writeFile(fakeGitPath, '#!/bin/sh\necho "LC_ALL=$LC_ALL"\necho "LANG=$LANG"\n', {
      mode: 0o755,
    });

    const { stdout } = await runGit(["ignored"], {
      cwd: dir,
      bin: fakeGitPath,
      env: { ...process.env, LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8" },
    });

    expect(stdout).toContain("LC_ALL=C");
    expect(stdout).toContain("LANG=C");
  });

  test("rejects on timeout instead of hanging forever", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await expect(runGit(["log"], { cwd: dir, timeout: 1 })).rejects.toThrow();
  });
});

describe("getRepoRoot", () => {
  test("returns toplevel", async () => {
    const dir = await makeRepo();
    const root = await getRepoRoot(dir);
    const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
    expect(root).toBe(stdout.trim());
  });
});

describe("hasHead", () => {
  test("false before first commit, true after", async () => {
    const dir = await makeRepo();
    expect(await hasHead(dir)).toBe(false);
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    expect(await hasHead(dir)).toBe(true);
  });
});

describe("catFileBlob", () => {
  test("returns buffer for existing blob, null for missing", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello world");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const { stdout: hashOut } = await execFileP("git", ["hash-object", "a.txt"], { cwd: dir });
    const buf = await catFileBlob(dir, hashOut.trim());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf?.toString("utf8")).toBe("hello world");

    const missing = await catFileBlob(dir, "1".repeat(40));
    expect(missing).toBeNull();
  });

  test("throws on invalid hash", async () => {
    const dir = await makeRepo();
    await expect(catFileBlob(dir, "not-a-hash")).rejects.toThrow();
  });
});

describe("listUntracked", () => {
  test("lists untracked files sorted, respects pathspec and cwd", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "z_new.txt"), "z");
    await writeFile(join(dir, "a_new.txt"), "a");
    const list = await listUntracked(dir, []);
    expect(list).toEqual(["a_new.txt", "z_new.txt"]);
  });
});

describe("noIndexPatch / diffPatch", () => {
  test("noIndexPatch produces a new-file patch, does not throw on diff", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "new.txt"), "content\n");
    const patch = await noIndexPatch(dir, "new.txt");
    expect(patch).toContain("new file mode");
    expect(patch).toContain("new.txt");
  });

  test("diffPatch produces a diff against HEAD", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "b\n");
    const patch = await diffPatch(dir, ["HEAD"]);
    expect(patch).toContain("diff --git a/a.txt b/a.txt");
  });

  test("diffPatch pins diff.noprefix against user config", async () => {
    const dir = await makeRepo();
    await execFileP("git", ["config", "diff.noprefix", "true"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "a\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "b\n");
    const patch = await diffPatch(dir, ["HEAD"]);
    expect(patch).toContain("--- a/a.txt");
    expect(patch).toContain("+++ b/a.txt");
  });
});

describe("getEmptyTree", () => {
  test("returns the well-known sha1 empty tree for a sha1 repo", async () => {
    const dir = await makeRepo();
    expect(await getEmptyTree(dir)).toBe(EMPTY_TREE);
  });
});
