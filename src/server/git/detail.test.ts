import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { getCommitDetail } from "./detail";

const execFileP = promisify(execFile);
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-detail-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir, env: ENV });
  return dir;
}

async function commit(dir: string, message: string): Promise<string> {
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

describe("getCommitDetail", () => {
  test("returns metadata, subject/body split, and a modified file with additions/deletions", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "line1\nline2\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    const h1 = await commit(dir, "init");
    await writeFile(join(dir, "a.txt"), "line1\nline2\nline3\n");
    await execFileP("git", ["add", "."], { cwd: dir });
    const h2 = await commit(dir, "second\n\nsome body text");

    const detail = await getCommitDetail(dir, h2);
    expect(detail.hash).toBe(h2);
    expect(detail.parents).toEqual([h1]);
    expect(detail.subject).toBe("second");
    expect(detail.body).toBe("some body text");
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.status).toBe("M");
    expect(detail.files[0]?.path).toBe("a.txt");
    expect(detail.files[0]?.additions).toBe(1);
    expect(detail.files[0]?.deletions).toBe(0);
  });

  test("reports a rename with oldPath and additions/deletions", async () => {
    const dir = await makeRepo();
    await writeFile(
      join(dir, "old.txt"),
      "same content that is long enough to be detected as a rename\n",
    );
    await execFileP("git", ["add", "."], { cwd: dir });
    await commit(dir, "init");
    await execFileP("git", ["mv", "old.txt", "renamed.txt"], { cwd: dir });
    const h2 = await commit(dir, "rename");

    const detail = await getCommitDetail(dir, h2);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.status).toBe("R");
    expect(detail.files[0]?.path).toBe("renamed.txt");
    expect(detail.files[0]?.oldPath).toBe("old.txt");
  });

  test("binary file reports null additions/deletions", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    await execFileP("git", ["add", "."], { cwd: dir });
    const h1 = await commit(dir, "add binary");

    const detail = await getCommitDetail(dir, h1);
    expect(detail.files[0]?.additions).toBeNull();
    expect(detail.files[0]?.deletions).toBeNull();
  });
});
