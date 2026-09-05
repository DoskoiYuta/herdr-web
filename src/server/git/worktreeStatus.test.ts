import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { listStatus } from "./worktreeStatus";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-status-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("listStatus", () => {
  test("empty repo with no commits works", async () => {
    const dir = await makeRepo();
    const result = await listStatus(dir);
    expect(result).toEqual([]);
  });

  test.each([
    [
      "untracked file",
      async (dir: string) => {
        await writeFile(join(dir, "new.txt"), "x\n");
      },
      "new.txt",
      "untracked",
    ],
    [
      "modified tracked file",
      async (dir: string) => {
        await writeFile(join(dir, "a.txt"), "changed\n");
      },
      "a.txt",
      "modified",
    ],
    [
      "deleted tracked file",
      async (dir: string) => {
        await rm(join(dir, "a.txt"));
      },
      "a.txt",
      "deleted",
    ],
    [
      "added (staged new) file",
      async (dir: string) => {
        await writeFile(join(dir, "staged.txt"), "x\n");
        await execFileP("git", ["add", "staged.txt"], { cwd: dir });
      },
      "staged.txt",
      "added",
    ],
  ] as const)("status: %s -> %s", async (_label, mutate, path, expectedStatus) => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });

    await mutate(dir);

    const result = await listStatus(dir);
    const entry = result.find((s) => s.path === path);
    expect(entry?.status).toBe(expectedStatus);
  });

  test("renamed tracked file reports status entry at the new path", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "old.txt"), "same content that is long enough to detect rename\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await execFileP("git", ["mv", "old.txt", "new.txt"], { cwd: dir });

    const result = await listStatus(dir);
    const entry = result.find((s) => s.path === "new.txt");
    expect(entry?.status).toBe("renamed");
  });
});
