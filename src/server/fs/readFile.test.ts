import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { readWorktreeFile } from "./readFile";

function asOk(body: unknown): { kind: string; path: string; size?: number; contents?: string } {
  return body as { kind: string; path: string; size?: number; contents?: string };
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
});
