import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { readWorktreeFile } from "./readFile";

function asOk(body: unknown): {
  kind: string;
  path: string;
  size?: number;
  contents?: string;
  hash?: string;
  editable?: boolean;
  readOnlyReason?: string;
} {
  return body as {
    kind: string;
    path: string;
    size?: number;
    contents?: string;
    hash?: string;
    editable?: boolean;
    readOnlyReason?: string;
  };
}
function asError(body: unknown): { error: string } {
  return body as { error: string };
}

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-readfile-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("readWorktreeFile", () => {
  test("text file -> kind text with contents", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello world\n");
    const res = await readWorktreeFile(dir, "a.txt");
    expect(res.status).toBe(200);
    expect(asOk(res.body).kind).toBe("text");
    expect(asOk(res.body).contents).toBe("hello world\n");
  });

  test("binary file -> kind binary, no contents", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    const res = await readWorktreeFile(dir, "bin.dat");
    expect(res.status).toBe(200);
    expect(asOk(res.body).kind).toBe("binary");
    expect(asOk(res.body).contents).toBeUndefined();
  });

  test("file over the size cap -> kind too-large without reading contents", async () => {
    const dir = await makeRepo();
    const path = join(dir, "big.bin");
    const fh = await open(path, "w");
    await fh.truncate(2 * 1024 * 1024 + 1);
    await fh.close();
    const res = await readWorktreeFile(dir, "big.bin");
    expect(res.status).toBe(200);
    expect(asOk(res.body).kind).toBe("too-large");
    expect(asOk(res.body).contents).toBeUndefined();
  });

  test.each([["../etc/passwd"], ["/etc/passwd"]])(
    "invalid path %s -> 400 invalid-path",
    async (path) => {
      const dir = await makeRepo();
      const res = await readWorktreeFile(dir, path);
      expect(res.status).toBe(400);
      expect(asError(res.body).error).toBe("invalid-path");
    },
  );

  test("symlink pointing outside the repo -> 400 outside-repo", async () => {
    const dir = await makeRepo();
    const outsideDir = await mkdtemp(join(tmpdir(), "herdr-web-readfile-outside-"));
    dirs.push(outsideDir);
    await writeFile(join(outsideDir, "secret.txt"), "secret\n");
    await symlink(join(outsideDir, "secret.txt"), join(dir, "link.txt"));

    const res = await readWorktreeFile(dir, "link.txt");
    expect(res.status).toBe(400);
    expect(asError(res.body).error).toBe("outside-repo");
  });

  test("directory -> 400 not-a-file", async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, "sub"));
    const res = await readWorktreeFile(dir, "sub");
    expect(res.status).toBe(400);
    expect(asError(res.body).error).toBe("not-a-file");
  });

  test("missing file -> 404 not-found", async () => {
    const dir = await makeRepo();
    const res = await readWorktreeFile(dir, "nope.txt");
    expect(res.status).toBe(404);
    expect(asError(res.body).error).toBe("not-found");
  });

  // Without this, Files and Diff would compute different hashes for the same
  // bytes, so a save's baseHash could never match what Diff shows as HEAD.
  // Compared against `git hash-object` itself (not `gitBlobHash` again) so
  // this actually checks Files and Diff agree on a hash for the same
  // content, rather than just re-deriving readWorktreeFile's own formula.
  test("text file -> hash matches `git hash-object`", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello world\n");
    const { stdout } = await execFileP("git", ["hash-object", "a.txt"], { cwd: dir });

    const res = await readWorktreeFile(dir, "a.txt");

    expect(asOk(res.body).hash).toBe(stdout.trim());
  });

  test("plain text file -> editable, no readOnlyReason", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "hello\n");
    const res = await readWorktreeFile(dir, "a.txt");
    expect(asOk(res.body).editable).toBe(true);
    expect(asOk(res.body).readOnlyReason).toBeUndefined();
  });

  // Without this, saving a symlink target as if it were the link's own
  // contents would silently replace the symlink with a plain file on write.
  test("symlink whose target is inside the repo -> not editable, reason symlink", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "real.txt"), "hello\n");
    await symlink(join(dir, "real.txt"), join(dir, "link.txt"));

    const res = await readWorktreeFile(dir, "link.txt");
    expect(res.status).toBe(200);
    expect(asOk(res.body).editable).toBe(false);
    expect(asOk(res.body).readOnlyReason).toBe("symlink");
  });

  // Without this, editing and saving a non-UTF-8 file (already silently
  // mis-decoded into a JS string) would re-encode and corrupt its bytes.
  test("non-UTF-8 bytes -> not editable, reason not-utf8", async () => {
    const dir = await makeRepo();
    // A lone continuation byte is invalid UTF-8 on its own.
    await writeFile(join(dir, "latin1.txt"), Buffer.from([0x68, 0x69, 0xe9]));
    const res = await readWorktreeFile(dir, "latin1.txt");
    expect(res.status).toBe(200);
    expect(asOk(res.body).kind).toBe("text");
    expect(asOk(res.body).editable).toBe(false);
    expect(asOk(res.body).readOnlyReason).toBe("not-utf8");
  });

  // Without this, editing tracked config under .git (e.g. a hook) through
  // the file viewer could desync the worktree from git's own bookkeeping.
  test(".git/config -> not editable, reason git-internal", async () => {
    const dir = await makeRepo();
    const res = await readWorktreeFile(dir, ".git/config");
    expect(res.status).toBe(200);
    expect(asOk(res.body).editable).toBe(false);
    expect(asOk(res.body).readOnlyReason).toBe("git-internal");
  });
});
