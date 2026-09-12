import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile as writeFixture,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { gitBlobHash } from "../git/blobHash";
import { writeWorktreeFile } from "./writeFile";
import { MAX_FILE_BYTES } from "./readFile";

function asOk(body: unknown): { hash: string; size: number } {
  return body as { hash: string; size: number };
}
function asError(body: unknown): { error: string; hash?: string; reason?: string } {
  return body as { error: string; hash?: string; reason?: string };
}

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-writefile-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("writeWorktreeFile", () => {
  test("overwrites an existing file and returns the new hash/size", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "a.txt"), "hello\n");
    const baseHash = gitBlobHash(Buffer.from("hello\n"));

    const res = await writeWorktreeFile(dir, "a.txt", "hello world\n", baseHash);

    expect(res.status).toBe(200);
    expect(asOk(res.body)).toEqual({
      hash: gitBlobHash(Buffer.from("hello world\n")),
      size: Buffer.byteLength("hello world\n"),
    });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello world\n");
  });

  // Without this, two clients editing the same file could both write from a
  // stale view of it and one edit would silently vanish.
  test("baseHash no longer matching disk -> 409 conflict, file unchanged", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "a.txt"), "hello\n");
    const staleHash = gitBlobHash(Buffer.from("some other content"));

    const res = await writeWorktreeFile(dir, "a.txt", "new contents\n", staleHash);

    expect(res.status).toBe(409);
    expect(asError(res.body)).toEqual({
      error: "conflict",
      hash: gitBlobHash(Buffer.from("hello\n")),
    });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello\n");
  });

  test("git-internal path (.git/config) -> 422 read-only, file unchanged", async () => {
    const dir = await makeRepo();
    const before = await readFile(join(dir, ".git", "config"), "utf8");

    const res = await writeWorktreeFile(dir, ".git/config", "[bogus]\n", "irrelevant");

    expect(res.status).toBe(422);
    expect(asError(res.body)).toEqual({ error: "read-only", reason: "git-internal" });
    expect(await readFile(join(dir, ".git", "config"), "utf8")).toBe(before);
  });

  // Without this, a symlinked directory pointing at .git (e.g. `lnk -> .git`)
  // would pass a literal `path.split("/")[0] === ".git"` check on the raw
  // path while still resolving into the real .git directory, letting a save
  // overwrite git's own bookkeeping.
  test("symlinked directory that resolves into .git -> 422 read-only, file unchanged", async () => {
    const dir = await makeRepo();
    const before = await readFile(join(dir, ".git", "config"), "utf8");
    await symlink(join(dir, ".git"), join(dir, "lnk"));

    const res = await writeWorktreeFile(dir, "lnk/config", "[bogus]\n", "irrelevant");

    expect(res.status).toBe(422);
    expect(asError(res.body)).toEqual({ error: "read-only", reason: "git-internal" });
    expect(await readFile(join(dir, ".git", "config"), "utf8")).toBe(before);
  });

  // Without this, pointing `root` at a repo's PARENT directory (allowed,
  // since a review/worktree root can be any allowed directory) and reaching
  // the repo's `.git` as a non-leading path segment would bypass a check
  // that only looked at `path`'s first segment.
  test("root above the repo, path into its .git -> 422 read-only, file unchanged", async () => {
    const dir = await makeRepo();
    const before = await readFile(join(dir, ".git", "config"), "utf8");
    const parent = dirname(dir);
    const relPath = `${basename(dir)}/.git/config`;

    const res = await writeWorktreeFile(parent, relPath, "[bogus]\n", "irrelevant");

    expect(res.status).toBe(422);
    expect(asError(res.body)).toEqual({ error: "read-only", reason: "git-internal" });
    expect(await readFile(join(dir, ".git", "config"), "utf8")).toBe(before);
  });

  test("symlink -> 422 read-only, link itself unchanged", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "real.txt"), "hello\n");
    await symlink(join(dir, "real.txt"), join(dir, "link.txt"));
    const hash = gitBlobHash(Buffer.from("hello\n"));

    const res = await writeWorktreeFile(dir, "link.txt", "new\n", hash);

    expect(res.status).toBe(422);
    expect(asError(res.body)).toEqual({ error: "read-only", reason: "symlink" });
    expect(await readFile(join(dir, "real.txt"), "utf8")).toBe("hello\n");
  });

  test("non-UTF-8 file -> 422 read-only, file unchanged", async () => {
    const dir = await makeRepo();
    const original = Buffer.from([0x68, 0x69, 0xe9]);
    await writeFixture(join(dir, "latin1.txt"), original);
    const hash = gitBlobHash(original);

    const res = await writeWorktreeFile(dir, "latin1.txt", "new\n", hash);

    expect(res.status).toBe(422);
    expect(asError(res.body)).toEqual({ error: "read-only", reason: "not-utf8" });
    expect(await readFile(join(dir, "latin1.txt"))).toEqual(original);
  });

  // v1 only overwrites; a missing file is never created by a PUT.
  test("missing file -> 404 not-found, nothing created", async () => {
    const dir = await makeRepo();

    const res = await writeWorktreeFile(dir, "nope.txt", "hi\n", "irrelevant");

    expect(res.status).toBe(404);
    expect(asError(res.body).error).toBe("not-found");
    await expect(stat(join(dir, "nope.txt"))).rejects.toThrow();
  });

  // Without this, a save just under the read cap could produce a file the
  // viewer can open but never save again (a write-only cliff).
  test("contents over the size cap -> 413 too-large, file unchanged", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "a.txt"), "hello\n");
    const hash = gitBlobHash(Buffer.from("hello\n"));
    const big = "x".repeat(MAX_FILE_BYTES + 1);

    const res = await writeWorktreeFile(dir, "a.txt", big, hash);

    expect(res.status).toBe(413);
    expect(asError(res.body).error).toBe("too-large");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello\n");
  });

  // Without this, saving a shell script through the file viewer would
  // silently drop its execute bit, breaking anything that runs it directly.
  test("preserves the file's mode (execute bit) across a save", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "run.sh"), "#!/bin/sh\necho hi\n");
    await chmod(join(dir, "run.sh"), 0o755);
    const hash = gitBlobHash(Buffer.from("#!/bin/sh\necho hi\n"));

    const res = await writeWorktreeFile(dir, "run.sh", "#!/bin/sh\necho bye\n", hash);

    expect(res.status).toBe(200);
    const mode = (await stat(join(dir, "run.sh"))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  // Without this, two racing saves of the same file could both read the same
  // pre-write content, both pass the baseHash check, and both "succeed" —
  // silently discarding whichever write lost the race, with no 409 to warn
  // either caller.
  test("two concurrent writes to the same path -> one succeeds, one gets 409", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "a.txt"), "hello\n");
    const hash = gitBlobHash(Buffer.from("hello\n"));

    const [first, second] = await Promise.all([
      writeWorktreeFile(dir, "a.txt", "from first\n", hash),
      writeWorktreeFile(dir, "a.txt", "from second\n", hash),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  // Without this, a lock keyed by the raw `root`/`path` strings would let two
  // concurrent writes that name the same file with different spellings
  // (here: a trailing slash on `root`) interleave instead of serialize, so
  // both could read the same pre-write content, both pass the baseHash
  // check, and one write silently disappears with no 409 to warn either
  // caller.
  test("two concurrent writes naming the same file via differently-spelled roots -> one gets 409", async () => {
    const dir = await makeRepo();
    await writeFixture(join(dir, "a.txt"), "hello\n");
    const hash = gitBlobHash(Buffer.from("hello\n"));

    const [first, second] = await Promise.all([
      writeWorktreeFile(dir, "a.txt", "from first\n", hash),
      writeWorktreeFile(`${dir}/`, "a.txt", "from second\n", hash),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
