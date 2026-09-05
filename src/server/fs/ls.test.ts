import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { listDir } from "./ls";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-ls-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listDir", () => {
  test.each([
    ["a.txt", "file"],
    ["sub", "dir"],
    [".dotfile", "file"],
  ] as const)("reports %s as kind %s", async (name, kind) => {
    const dir = await makeRepo();
    if (kind === "dir") await mkdir(join(dir, name));
    else await writeFile(join(dir, name), "x\n");

    const result = await listDir(dir, "");
    expect(result.status).toBe(200);
    const body = result.body as { entries: { name: string; kind: string }[] };
    expect(body.entries).toContainEqual({ name, kind });
  });

  test("reports a symlink as kind symlink without following it", async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, "target"));
    await symlink(join(dir, "target"), join(dir, "link"));

    const result = await listDir(dir, "");
    expect(result.status).toBe(200);
    const body = result.body as { entries: { name: string; kind: string }[] };
    expect(body.entries).toContainEqual({ name: "link", kind: "symlink" });
  });

  test("includes dotfiles and .git, excludes nothing that `ls -a` would show", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, ".hidden"), "x\n");

    const result = await listDir(dir, "");
    expect(result.status).toBe(200);
    const body = result.body as { entries: { name: string }[] };
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual([".git", ".hidden"]);
  });

  test("lists a subdirectory's own entries (non-recursive)", async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "a.txt"), "x\n");
    await mkdir(join(dir, "sub", "nested"));

    const result = await listDir(dir, "sub");
    expect(result.status).toBe(200);
    const body = result.body as { entries: { name: string; kind: string }[] };
    expect(body.entries.map((e) => e.name).sort()).toEqual(["a.txt", "nested"]);
  });

  test.each([["../escape"], ["/abs/path"]] as const)(
    "rejects an invalid dir %s with invalid-path",
    async (invalidDir) => {
      const dir = await makeRepo();
      const result = await listDir(dir, invalidDir);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid-path" });
    },
  );

  test("a symlink dir pointing outside the repo -> outside-repo", async () => {
    const dir = await makeRepo();
    const outside = await mkdtemp(join(tmpdir(), "herdr-web-ls-outside-"));
    dirs.push(outside);
    await symlink(outside, join(dir, "escape"));

    const result = await listDir(dir, "escape");
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "outside-repo" });
  });

  test("a missing dir -> not-found (404)", async () => {
    const dir = await makeRepo();
    const result = await listDir(dir, "nope");
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "not-found" });
  });

  test("a file used as dir -> not-a-directory (400)", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "x\n");
    const result = await listDir(dir, "a.txt");
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "not-a-directory" });
  });
});
