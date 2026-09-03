import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import type { FilesResponse } from "../../contract/git";
import { gitBlobHash } from "./blobHash";
import { resolveFiles } from "./files";

function asFiles(body: unknown): FilesResponse {
  return body as FilesResponse;
}
function asError(body: unknown): { error: string } {
  return body as { error: string };
}

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-files-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveFiles", () => {
  test("missing path -> 400", async () => {
    const dir = await makeRepo();
    const res = await resolveFiles({
      root: dir,
      path: "",
      prev: null,
      type: "change",
      oldHash: null,
      newHash: null,
    });
    expect(res.status).toBe(400);
  });

  test("invalid hash format -> 400", async () => {
    const dir = await makeRepo();
    const res = await resolveFiles({
      root: dir,
      path: "a.txt",
      type: "change",
      oldHash: "not-hex",
      newHash: null,
    });
    expect(res.status).toBe(400);
  });

  test("type new -> oldFile null; hydrates newFile via cat-file", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const { stdout } = await execFileP("git", ["hash-object", "a.txt"], { cwd: dir });
    const hash = stdout.trim();

    const res = await resolveFiles({ root: dir, path: "a.txt", type: "new", newHash: hash });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).oldFile).toBeNull();
    expect(asFiles(res.body).newFile?.contents).toBe("hello");
    expect(asFiles(res.body).newFile?.cacheKey.startsWith(hash)).toBe(true);
  });

  test("type deleted -> newFile null", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const { stdout } = await execFileP("git", ["hash-object", "a.txt"], { cwd: dir });
    const hash = stdout.trim();

    const res = await resolveFiles({ root: dir, path: "a.txt", type: "deleted", oldHash: hash });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).newFile).toBeNull();
    expect(asFiles(res.body).oldFile?.contents).toBe("hello");
  });

  test("newHash missing from object DB -> falls back to worktree, matches hash -> 200", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "hello world");
    const newHash = gitBlobHash(Buffer.from("hello world"));

    const res = await resolveFiles({ root: dir, path: "a.txt", type: "change", newHash });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).newFile?.contents).toBe("hello world");
  });

  test("worktree read outside repo -> 400 outside-repo", async () => {
    const dir = await makeRepo();
    const bogusHash = "1".repeat(40);
    const res = await resolveFiles({
      root: dir,
      path: "../".repeat(20) + "etc/passwd",
      type: "change",
      newHash: bogusHash,
    });
    expect(res.status).toBe(400);
    expect(asError(res.body).error).toBe("outside-repo");
  });

  test("worktree read missing file -> 404 not-found", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "x");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const bogusHash = "1".repeat(40);
    const res = await resolveFiles({
      root: dir,
      path: "nope.txt",
      type: "change",
      newHash: bogusHash,
    });
    expect(res.status).toBe(404);
    expect(asError(res.body).error).toBe("not-found");
  });

  test("stale worktree hash mismatch -> 409", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "changed");
    const staleHash = gitBlobHash(Buffer.from("some other content"));

    const res = await resolveFiles({
      root: dir,
      path: "a.txt",
      type: "change",
      newHash: staleHash,
    });
    expect(res.status).toBe(409);
    expect(asError(res.body).error).toBe("stale");
  });

  test("binary content -> 500 binary", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const newHash = gitBlobHash(Buffer.from([0, 1, 2, 3]));

    const res = await resolveFiles({ root: dir, path: "blob.bin", type: "new", newHash });
    expect(res.status).toBe(500);
    expect(asError(res.body).error).toBe("binary");
  });

  test("symlink in worktree: content served is the link target string, not dereferenced", async () => {
    const dir = await makeRepo();
    await symlink("target-of-link", join(dir, "link.txt"));
    const newHash = gitBlobHash(Buffer.from("target-of-link"));

    const res = await resolveFiles({ root: dir, path: "link.txt", type: "new", newHash });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).newFile?.contents).toBe("target-of-link");
  });

  test("gitattributes text=auto + CRLF worktree file -> 200 via filtered hash, not 409", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, ".gitattributes"), "* text=auto\n");
    await execFileP("git", ["add", ".gitattributes"], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "attrs"], { cwd: dir });

    await writeFile(join(dir, "a.txt"), "line1\r\nline2\r\n");
    const { stdout } = await execFileP("git", ["hash-object", "--path", "a.txt", "a.txt"], {
      cwd: dir,
    });
    const filteredHash = stdout.trim();

    const res = await resolveFiles({
      root: dir,
      path: "a.txt",
      type: "change",
      newHash: filteredHash,
    });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).newFile?.contents).toBe("line1\nline2\n");
  });

  test("prev sets oldFile name", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "old.txt"), "content");
    await execFileP("git", ["add", "."], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const { stdout } = await execFileP("git", ["hash-object", "old.txt"], { cwd: dir });
    const oldHash = stdout.trim();

    const res = await resolveFiles({
      root: dir,
      path: "new.txt",
      prev: "old.txt",
      type: "change",
      oldHash,
    });
    expect(res.status).toBe(200);
    expect(asFiles(res.body).oldFile?.name).toBe("old.txt");
  });
});
