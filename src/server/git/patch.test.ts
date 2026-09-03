import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { InvalidComparisonError, generatePatch } from "./patch";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-patch-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
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
  await execFileP("git", ["commit", "-q", "-m", message], { cwd: dir });
  const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("generatePatch", () => {
  test("default (to=WORKTREE, from=HEAD): staged + unstaged + untracked", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n", "init");
    await writeFile(join(dir, "a.txt"), "b\n");
    await writeFile(join(dir, "new.txt"), "new content\n");

    const result = await generatePatch({ cwd: dir, root: dir, selector: {} });

    expect(result.hash).toHaveLength(12);
    expect(result.untrackedCount).toBe(1);
    expect(result.untrackedTruncated).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]?.name).toBe("a.txt");
    expect(result.files[0]?.untracked).toBe(false);
    expect(result.files[1]?.name).toBe("new.txt");
    expect(result.files[1]?.untracked).toBe(true);
  });

  test("to=INDEX, from=HEAD: staged only, no untracked", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n", "init");
    await writeFile(join(dir, "a.txt"), "staged\n");
    await execFileP("git", ["add", "a.txt"], { cwd: dir });
    await writeFile(join(dir, "b.txt"), "unstaged only, not tracked yet\n");

    const result = await generatePatch({ cwd: dir, root: dir, selector: { to: "INDEX" } });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("a.txt");
    expect(result.untrackedCount).toBe(0);
  });

  test("two-commit range: from=a, to=b, no untracked", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "1\n", "c1");
    const h2 = await commit(dir, "a.txt", "2\n", "c2");
    await writeFile(join(dir, "untracked.txt"), "x\n");

    const result = await generatePatch({ cwd: dir, root: dir, selector: { from: h1, to: h2 } });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("a.txt");
    expect(result.untrackedCount).toBe(0);
  });

  test("from=<commit>, to=WORKTREE: diff against an arbitrary commit, untracked included", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "1\n", "c1");
    await commit(dir, "a.txt", "2\n", "c2");
    await writeFile(join(dir, "a.txt"), "3\n");
    await writeFile(join(dir, "new.txt"), "new\n");

    const result = await generatePatch({
      cwd: dir,
      root: dir,
      selector: { from: h1, to: "WORKTREE" },
    });
    const names = result.files.map((f) => f.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("new.txt");
    expect(result.untrackedCount).toBe(1);
  });

  test("from=WORKTREE is always rejected", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1\n", "c1");
    await expect(
      generatePatch({ cwd: dir, root: dir, selector: { from: "WORKTREE" } }),
    ).rejects.toThrow(InvalidComparisonError);
  });

  test("invalid commit-ish is rejected", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1\n", "c1");
    await expect(
      generatePatch({ cwd: dir, root: dir, selector: { from: "not-a-real-rev" } }),
    ).rejects.toThrow(InvalidComparisonError);
  });

  test("commit-ish starting with '-' is rejected without ever reaching git", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1\n", "c1");
    await expect(
      generatePatch({ cwd: dir, root: dir, selector: { from: "--evil-flag" } }),
    ).rejects.toThrow(InvalidComparisonError);
  });

  test("empty repo (no HEAD) shows untracked as new via empty tree", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello\n");
    const result = await generatePatch({ cwd: dir, root: dir, selector: {} });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("a.txt");
    expect(result.untrackedCount).toBe(1);
  });

  test("250 untracked files -> truncated true, only 200 included", async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, "many"));
    for (let i = 0; i < 250; i++) {
      await writeFile(join(dir, `f${String(i).padStart(4, "0")}.txt`), `content ${i}\n`);
    }
    const result = await generatePatch({ cwd: dir, root: dir, selector: {} });
    expect(result.untrackedCount).toBe(250);
    expect(result.untrackedTruncated).toBe(true);
    expect(result.files).toHaveLength(200);
  });

  test("pure rename (no content change): prevName set, hashes null (no index line in the patch)", async () => {
    const dir = await makeRepo();
    await commit(
      dir,
      "old.txt",
      "same content that is long enough to be detected as a rename\n",
      "init",
    );
    await execFileP("git", ["mv", "old.txt", "renamed.txt"], { cwd: dir });

    const result = await generatePatch({ cwd: dir, root: dir, selector: { to: "INDEX" } });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("renamed.txt");
    expect(result.files[0]?.prevName).toBe("old.txt");
  });

  test("rename with content change: prevName set, old/new hashes present", async () => {
    const dir = await makeRepo();
    const base = "same content that is long enough to be detected as a rename\n".repeat(20);
    await commit(dir, "old.txt", base, "init");
    await execFileP("git", ["mv", "old.txt", "renamed.txt"], { cwd: dir });
    await writeFile(join(dir, "renamed.txt"), `${base}one more line\n`);
    await execFileP("git", ["add", "renamed.txt"], { cwd: dir });

    const result = await generatePatch({ cwd: dir, root: dir, selector: { to: "INDEX" } });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe("renamed.txt");
    expect(result.files[0]?.prevName).toBe("old.txt");
    expect(result.files[0]?.oldHash).not.toBeNull();
    expect(result.files[0]?.newHash).not.toBeNull();
  });
});
