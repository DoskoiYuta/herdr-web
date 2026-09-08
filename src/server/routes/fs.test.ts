import { realpath as realpathAsync } from "node:fs/promises";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, test } from "bun:test";
import { fsRoutes, type FsRoutesDeps } from "./fs";
import type { Trasher } from "../fs/trash";

const dirs: string[] = [];

/** Response bodies are asserted field-by-field below; skip re-typing them here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

/** A plain directory — these are filesystem-only endpoints, no git needed. */
async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-fs-routes-test-"));
  dirs.push(dir);
  return realpathAsync(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeApp(deps: FsRoutesDeps) {
  return new Hono().route("/api/fs", fsRoutes(deps));
}

describe("GET /api/fs/ls", () => {
  test("lists the root's own entries for an allowed root", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "a\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/ls?root=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.entries).toContainEqual({ name: "a.txt", kind: "file" });
  });

  test("lists a subdirectory via dir=", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "a.txt"), "a\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/ls?root=${encodeURIComponent(dir)}&dir=sub`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.entries).toEqual([{ name: "a.txt", kind: "file" }]);
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [] }); // nothing allowed beyond $HOME, and dir is under tmpdir

    const res = await app.request(`/api/fs/ls?root=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(403);
  });

  test("unknown root path -> 404", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/ls?root=${encodeURIComponent(`${dir}-does-not-exist`)}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/fs/file", () => {
  test("reads a file for an allowed root", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "hello\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/file?root=${encodeURIComponent(dir)}&path=a.txt`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ kind: "text", path: "a.txt", contents: "hello\n", size: 6 });
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "hello\n");
    const app = makeApp({ allowedRoots: [] });

    const res = await app.request(`/api/fs/file?root=${encodeURIComponent(dir)}&path=a.txt`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/fs/stat", () => {
  test("reports existing and missing paths in one response", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "a\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(
      `/api/fs/stat?root=${encodeURIComponent(dir)}&paths=${encodeURIComponent("a.txt")}&paths=${encodeURIComponent("missing.txt")}`,
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ "a.txt": true, "missing.txt": false });
  });

  // Without this, a path with a literal comma would be mis-split by a
  // comma-joining encoding (the repeated-param format below must not
  // reintroduce that).
  test("a path containing a comma is checked as one path, not split", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a,b.txt"), "a\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(
      `/api/fs/stat?root=${encodeURIComponent(dir)}&paths=${encodeURIComponent("a,b.txt")}`,
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ "a,b.txt": true });
  });

  // Without this, a stale tab path from another worktree (e.g. carried over
  // via the shared repoKey tab list) would 400/500 the whole stat call
  // instead of just reporting that one path as absent.
  test.each([
    ["a path escaping the root via ..", "../etc/passwd"],
    ["an absolute path", "/etc/passwd"],
  ])("%s -> false rather than an error", async (_name, path) => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(
      `/api/fs/stat?root=${encodeURIComponent(dir)}&paths=${encodeURIComponent(path)}`,
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ [path]: false });
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [] });

    const res = await app.request(`/api/fs/stat?root=${encodeURIComponent(dir)}&paths=a.txt`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/fs/raw", () => {
  // 1x1 transparent PNG.
  const PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  // Without this, an image never reaches the browser's <img> tag intact.
  test("serves a PNG with image/png and the exact bytes", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "logo.png"), PNG_BYTES);
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/raw?root=${encodeURIComponent(dir)}&path=logo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  // Without this, this endpoint would double as an arbitrary-file reader
  // for anything with an unrecognized extension, bypassing /file's text/
  // binary handling entirely.
  test("unsupported extension -> 415", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "hello\n");
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/raw?root=${encodeURIComponent(dir)}&path=a.txt`);
    expect(res.status).toBe(415);
    expect(await json(res)).toEqual({ error: "unsupported" });
  });

  test("missing file -> 404", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/raw?root=${encodeURIComponent(dir)}&path=nope.png`);
    expect(res.status).toBe(404);
  });

  // Without this, the raw endpoint would inherit no path-traversal
  // protection just because it skips readWorktreeFile's JSON body shape.
  test("path traversal -> 400", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(
      `/api/fs/raw?root=${encodeURIComponent(dir)}&path=${encodeURIComponent("../etc/passwd.png")}`,
    );
    expect(res.status).toBe(400);
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "logo.png"), PNG_BYTES);
    const app = makeApp({ allowedRoots: [] });

    const res = await app.request(`/api/fs/raw?root=${encodeURIComponent(dir)}&path=logo.png`);
    expect(res.status).toBe(403);
  });

  // Without this, a huge PDF/image could be requested and buffered/streamed
  // without bound.
  test("file over the 50 MiB cap -> 413", async () => {
    const dir = await makeDir();
    const path = join(dir, "big.png");
    const fh = await open(path, "w");
    await fh.truncate(50 * 1024 * 1024 + 1);
    await fh.close();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/raw?root=${encodeURIComponent(dir)}&path=big.png`);
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ error: "too-large" });
  });
});

describe("POST /api/fs/upload", () => {
  function multipart(parts: { name: string; contents: string }[]): FormData {
    const formData = new FormData();
    for (const part of parts) {
      formData.append("file", new File([part.contents], part.name));
    }
    return formData;
  }

  test("writes two parts, one nested, and reports them back", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [dir] });

    const res = await app.request(`/api/fs/upload?root=${encodeURIComponent(dir)}&dir=`, {
      method: "POST",
      body: multipart([
        { name: "new.txt", contents: "new\n" },
        { name: "sub/nested.txt", contents: "nested\n" },
      ]),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.written.sort()).toEqual(["new.txt", "sub/nested.txt"]);
    expect((await readFile(join(dir, "new.txt"))).toString()).toBe("new\n");
    expect((await readFile(join(dir, "sub/nested.txt"))).toString()).toBe("nested\n");
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    const app = makeApp({ allowedRoots: [] }); // nothing allowed beyond $HOME, and dir is under tmpdir

    const res = await app.request(`/api/fs/upload?root=${encodeURIComponent(dir)}&dir=`, {
      method: "POST",
      body: multipart([{ name: "new.txt", contents: "new\n" }]),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/fs/trash", () => {
  function fakeTrasher(result: Awaited<ReturnType<Trasher["moveToTrash"]>>): {
    trasher: Trasher;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      trasher: {
        moveToTrash: (real: string) => {
          calls.push(real);
          return Promise.resolve(result);
        },
      },
    };
  }

  test("trashes a file, passing the realpath'd absolute path to the trasher", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "x\n");
    const { trasher, calls } = fakeTrasher({ ok: true });
    const app = makeApp({ allowedRoots: [dir], trasher });

    const res = await app.request(
      `/api/fs/trash?root=${encodeURIComponent(dir)}&path=${encodeURIComponent("a.txt")}`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ trashed: "a.txt" });
    expect(calls).toEqual([join(dir, "a.txt")]);
  });

  test("root outside allowed roots -> 403", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "x\n");
    const { trasher } = fakeTrasher({ ok: true });
    const app = makeApp({ allowedRoots: [], trasher });

    const res = await app.request(`/api/fs/trash?root=${encodeURIComponent(dir)}&path=a.txt`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  test.each([["../escape.txt"], ["/etc/passwd"], [""]])(
    "invalid path %s -> 400 invalid-path",
    async (path) => {
      const dir = await makeDir();
      const { trasher, calls } = fakeTrasher({ ok: true });
      const app = makeApp({ allowedRoots: [dir], trasher });

      const res = await app.request(
        `/api/fs/trash?root=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`,
        { method: "POST" },
      );
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: "invalid-path" });
      expect(calls).toEqual([]);
    },
  );

  test.each([[".git"], [".git/config"]])(
    "refuses to trash %s -> 400 forbidden-path",
    async (path) => {
      const dir = await makeDir();
      await mkdir(join(dir, ".git"), { recursive: true });
      await writeFile(join(dir, ".git", "config"), "x\n");
      const { trasher, calls } = fakeTrasher({ ok: true });
      const app = makeApp({ allowedRoots: [dir], trasher });

      const res = await app.request(
        `/api/fs/trash?root=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`,
        { method: "POST" },
      );
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: "forbidden-path" });
      expect(calls).toEqual([]);
    },
  );

  test("a path outside the root -> 400 outside-repo", async () => {
    const dir = await makeDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "herdr-web-fs-trash-outside-"));
    dirs.push(outsideDir);
    await writeFile(join(outsideDir, "secret.txt"), "x\n");
    const { symlink } = await import("node:fs/promises");
    await symlink(join(outsideDir, "secret.txt"), join(dir, "link.txt"));
    const { trasher, calls } = fakeTrasher({ ok: true });
    const app = makeApp({ allowedRoots: [dir], trasher });

    const res = await app.request(`/api/fs/trash?root=${encodeURIComponent(dir)}&path=link.txt`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "outside-repo" });
    expect(calls).toEqual([]);
  });

  test("a missing path -> 404 not-found", async () => {
    const dir = await makeDir();
    const { trasher, calls } = fakeTrasher({ ok: true });
    const app = makeApp({ allowedRoots: [dir], trasher });

    const res = await app.request(`/api/fs/trash?root=${encodeURIComponent(dir)}&path=nope.txt`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "not-found" });
    expect(calls).toEqual([]);
  });

  test("no trash backend available -> 501", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "x\n");
    const { trasher } = fakeTrasher({ ok: false, reason: "no-backend" });
    const app = makeApp({ allowedRoots: [dir], trasher });

    const res = await app.request(`/api/fs/trash?root=${encodeURIComponent(dir)}&path=a.txt`, {
      method: "POST",
    });
    expect(res.status).toBe(501);
    expect(await json(res)).toEqual({ error: "no-trash-backend" });
  });

  test("a failing trash backend -> 500 with the stderr message", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "a.txt"), "x\n");
    const { trasher } = fakeTrasher({ ok: false, reason: "failed", message: "permission denied" });
    const app = makeApp({ allowedRoots: [dir], trasher });

    const res = await app.request(`/api/fs/trash?root=${encodeURIComponent(dir)}&path=a.txt`, {
      method: "POST",
    });
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: "trash-failed", message: "permission denied" });
  });
});
