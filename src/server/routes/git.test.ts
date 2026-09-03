import { execFile } from "node:child_process";
import { realpath as realpathAsync } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { createTestApp } from "../testing/app-deps";
import { gitBlobHash } from "../git/blobHash";

const execFileP = promisify(execFile);
const dirs: string[] = [];

/** Response bodies are asserted field-by-field below; skip re-typing them here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-git-routes-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  return realpathAsync(dir);
}

async function commit(dir: string, file: string, content: string, message = "c"): Promise<string> {
  await writeFile(join(dir, file), content);
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", message], { cwd: dir });
  const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeApp(allowedRoots: string[]) {
  return createTestApp({ allowedRoots }).app;
}

describe("GET /api/git/patch", () => {
  test("default worktree comparison includes staged, unstaged, and untracked files", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n", "init");
    await writeFile(join(dir, "a.txt"), "b\n");
    await writeFile(join(dir, "new.txt"), "new\n");
    const app = makeApp([dir]);

    const res = await app.request(`/api/git/patch?repo=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(2);
    expect(body.files.map((f: { name: string }) => f.name).sort()).toEqual(["a.txt", "new.txt"]);
    expect(body.untrackedCount).toBe(1);
  });

  test("to=INDEX excludes untracked files", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "a\n", "init");
    await writeFile(join(dir, "a.txt"), "staged\n");
    await execFileP("git", ["add", "a.txt"], { cwd: dir });
    await writeFile(join(dir, "untracked.txt"), "u\n");
    const app = makeApp([dir]);

    const res = await app.request(`/api/git/patch?repo=${encodeURIComponent(dir)}&to=INDEX`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe("a.txt");
  });

  test("two-commit range diffs only committed changes", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "1\n", "c1");
    const h2 = await commit(dir, "a.txt", "2\n", "c2");
    const app = makeApp([dir]);

    const res = await app.request(
      `/api/git/patch?repo=${encodeURIComponent(dir)}&from=${h1}&to=${h2}`,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(1);
    expect(body.untrackedCount).toBe(0);
  });

  test("invalid commit-ish -> 400", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1\n", "c1");
    const app = makeApp([dir]);

    const res = await app.request(`/api/git/patch?repo=${encodeURIComponent(dir)}&from=not-a-rev`);
    expect(res.status).toBe(400);
  });

  test("repo outside allowed roots -> 403", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "1\n", "c1");
    const app = makeApp([]); // nothing allowed beyond $HOME, and dir is under tmpdir

    const res = await app.request(`/api/git/patch?repo=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(403);
  });

  test("missing repo query -> 400 (valibot validation)", async () => {
    const app = makeApp([]);
    const res = await app.request("/api/git/patch");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/git/files", () => {
  test("happy path hydrates old and new content", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "hello\n", "init");
    await writeFile(join(dir, "a.txt"), "hello world\n");
    const app = makeApp([dir]);
    const newHash = gitBlobHash(Buffer.from("hello world\n"));

    const res = await app.request(
      `/api/git/files?repo=${encodeURIComponent(dir)}&path=a.txt&type=change&newHash=${newHash}`,
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.newFile.contents).toBe("hello world\n");
  });

  test("stale worktree content -> 409", async () => {
    const dir = await makeRepo();
    await commit(dir, "a.txt", "hello\n", "init");
    // Fetch the patch first (as the client would), then modify the file
    // after that so the previously-reported hash no longer matches.
    await writeFile(join(dir, "a.txt"), "hello world\n");
    const staleHash = gitBlobHash(Buffer.from("hello world\n"));
    await writeFile(join(dir, "a.txt"), "hello world, changed again\n");
    const app = makeApp([dir]);

    const res = await app.request(
      `/api/git/files?repo=${encodeURIComponent(dir)}&path=a.txt&type=change&newHash=${staleHash}`,
    );
    expect(res.status).toBe(409);
  });

  test("binary content -> 500", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const newHash = gitBlobHash(Buffer.from([0, 1, 2, 3]));
    const app = makeApp([dir]);

    const res = await app.request(
      `/api/git/files?repo=${encodeURIComponent(dir)}&path=blob.bin&type=new&newHash=${newHash}`,
    );
    expect(res.status).toBe(500);
  });
});

describe("GET /api/git/graph", () => {
  test("includes an UNCOMMITTED pseudo node when the worktree is dirty", async () => {
    const dir = await makeRepo();
    const h1 = await commit(dir, "a.txt", "a\n", "init");
    await writeFile(join(dir, "a.txt"), "changed\n");
    const app = makeApp([dir]);

    const res = await app.request(`/api/git/graph?repo=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.hasUncommitted).toBe(true);
    expect(body.commits[0].hash).toBe("UNCOMMITTED");
    expect(body.commits[1].hash).toBe(h1);
  });
});

describe("GET /api/git/commit/:hash", () => {
  test("returns commit detail including a rename", async () => {
    const dir = await makeRepo();
    await commit(
      dir,
      "old.txt",
      "same content that is long enough to be detected as a rename\n",
      "init",
    );
    await execFileP("git", ["mv", "old.txt", "renamed.txt"], { cwd: dir });
    await execFileP("git", ["commit", "-q", "-m", "rename"], { cwd: dir });
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: dir });
    const h2 = stdout.trim();
    const app = makeApp([dir]);

    const res = await app.request(`/api/git/commit/${h2}?repo=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].status).toBe("R");
    expect(body.files[0].oldPath).toBe("old.txt");
  });
});
