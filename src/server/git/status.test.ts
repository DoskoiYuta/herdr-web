import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { hasUncommitted } from "./status";

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

describe("hasUncommitted", () => {
  test("false for a clean, committed repo", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    expect(await hasUncommitted(dir)).toBe(false);
  });

  test("true for an untracked file", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a");
    expect(await hasUncommitted(dir)).toBe(true);
  });

  test("true for an unstaged modification", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "a");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "b");
    expect(await hasUncommitted(dir)).toBe(true);
  });
});
