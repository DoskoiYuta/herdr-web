import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { importFiles } from "./upload";

function asOk(body: unknown): { written: string[] } {
  return body as { written: string[] };
}
function asError(body: unknown): { error: string; path?: string; paths?: string[] } {
  return body as { error: string; path?: string; paths?: string[] };
}

const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-upload-test-"));
  dirs.push(dir);
  return dir;
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("importFiles", () => {
  test("writes nested paths, creating directories as needed", async () => {
    const dir = await makeRepo();
    const res = await importFiles({
      root: dir,
      dir: "",
      files: [{ name: "photos/2024/a.jpg", data: bytes("img") }],
    });
    expect(res.status).toBe(200);
    expect(asOk(res.body).written).toEqual(["photos/2024/a.jpg"]);
    expect((await readFile(join(dir, "photos/2024/a.jpg"))).toString()).toBe("img");
  });

  test("existing destination without overwrite -> 409 with the conflicting paths, nothing written", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "old");
    const res = await importFiles({
      root: dir,
      dir: "",
      files: [
        { name: "a.txt", data: bytes("new") },
        { name: "b.txt", data: bytes("new-b") },
      ],
    });
    expect(res.status).toBe(409);
    expect(asError(res.body)).toEqual({ error: "exists", paths: ["a.txt"] });
    // The non-conflicting part of the batch must not be written either.
    await expect(readFile(join(dir, "b.txt"))).rejects.toThrow();
    expect((await readFile(join(dir, "a.txt"))).toString()).toBe("old");
  });

  test("overwrite=true replaces an existing file", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "a.txt"), "old");
    const res = await importFiles({
      root: dir,
      dir: "",
      files: [{ name: "a.txt", data: bytes("new") }],
      overwrite: true,
    });
    expect(res.status).toBe(200);
    expect((await readFile(join(dir, "a.txt"))).toString()).toBe("new");
  });

  test.each([["../escape.txt"], ["/etc/passwd"], ["a//b.txt"], [""]])(
    "invalid file name %s -> 400 invalid-path",
    async (name) => {
      const dir = await makeRepo();
      const res = await importFiles({ root: dir, dir: "", files: [{ name, data: bytes("x") }] });
      expect(res.status).toBe(400);
      expect(asError(res.body).error).toBe("invalid-path");
    },
  );

  test("symlinked subdir escaping the repo -> outside-repo, nothing written outside", async () => {
    const dir = await makeRepo();
    const outsideDir = await mkdtemp(join(tmpdir(), "herdr-web-upload-outside-"));
    dirs.push(outsideDir);
    await symlink(outsideDir, join(dir, "escape"));

    const res = await importFiles({
      root: dir,
      dir: "",
      files: [{ name: "escape/x.txt", data: bytes("x") }],
    });
    expect(res.status).toBe(400);
    expect(asError(res.body)).toEqual({ error: "outside-repo", path: "escape/x.txt" });
    await expect(readFile(join(outsideDir, "x.txt"))).rejects.toThrow();
  });

  test("directory at destination -> not-a-file", async () => {
    const dir = await makeRepo();
    await mkdir(join(dir, "sub"));
    const res = await importFiles({
      root: dir,
      dir: "",
      files: [{ name: "sub", data: bytes("x") }],
      overwrite: true,
    });
    expect(res.status).toBe(400);
    expect(asError(res.body)).toEqual({ error: "not-a-file", path: "sub" });
  });
});
