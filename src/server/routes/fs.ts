import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { join } from "node:path";
import {
  FileQuerySchema,
  LsQuerySchema,
  RawQuerySchema,
  StatQuerySchema,
  TrashQuerySchema,
  UploadQuerySchema,
  WriteFileRequestSchema,
} from "../../contract/fs";
import { isGitInternalPath } from "../fs/gitPath";
import { listDir } from "../fs/ls";
import { MAX_FILE_BYTES, readWorktreeFile, resolveWorktreeFile } from "../fs/readFile";
import { resolveRawFile } from "../fs/rawFile";
import { resolveInsideRoot } from "../fs/resolveInsideRoot";
import { createTrasher, type Trasher } from "../fs/trash";
import { importFiles, MAX_UPLOAD_BYTES } from "../fs/upload";
import { writeWorktreeFile } from "../fs/writeFile";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface FsRoutesDeps {
  /** Absolute paths allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  /** POST /api/fs/trash's OS-trash backend; injected in tests. */
  trasher?: Trasher;
  /** Called after a successful `PUT /api/fs/file` write, so callers can
   * broadcast a `repo-changed` the same way a git-status poll tick would —
   * editing an already-`modified` file leaves `git status --porcelain`
   * unchanged, so nothing else would notice the write happened. */
  onFileWritten?: (info: { root: string; path: string }) => void;
}

const isAllowed = isAllowedRoot;
const exists = pathExists;

function isInvalidTrashPath(path: string): boolean {
  if (path === "" || path.includes("\0")) return true;
  if (path.startsWith("/")) return true;
  return path.split("/").includes("..");
}

export function fsRoutes(deps: FsRoutesDeps = {}) {
  const allowedRoots = deps.allowedRoots ?? [];
  const trasher = deps.trasher ?? createTrasher();

  const app = new Hono()
    .get("/ls", vValidator("query", LsQuerySchema), async (c) => {
      const { root, dir } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const result = await listDir(root, dir ?? "");
      return c.json(result.body, result.status);
    })
    .get("/file", vValidator("query", FileQuerySchema), async (c) => {
      const { root, path } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const result = await readWorktreeFile(root, path);
      return c.json(result.body, result.status);
    })
    .put(
      "/file",
      async (c, next) => {
        // Reject an oversized body before valibot buffers it into JSON, same
        // as /upload's content-length guard. The JSON envelope (escaping,
        // root/path/baseHash) can roughly double `contents`' raw byte size,
        // so this only needs to catch requests that are *way* past the cap —
        // the exact cap is re-checked precisely against `contents` itself in
        // writeWorktreeFile.
        const contentLength = c.req.header("content-length");
        if (contentLength !== undefined && Number(contentLength) > MAX_FILE_BYTES * 4) {
          return c.json({ error: "too-large" as const }, 413);
        }
        await next();
      },
      vValidator("json", WriteFileRequestSchema),
      async (c) => {
        const { root, path, contents, baseHash } = c.req.valid("json");

        if (!(await isAllowed(root, allowedRoots))) {
          if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
          return c.json({ error: "forbidden" as const }, 403);
        }

        const result = await writeWorktreeFile(root, path, contents, baseHash);
        if (result.status === 200) {
          // The write already succeeded on disk — a throwing hook must not
          // turn that into a 500 for the client.
          try {
            deps.onFileWritten?.({ root, path });
          } catch (err) {
            console.error("onFileWritten hook threw", err);
          }
        }
        return c.json(result.body, result.status);
      },
    )
    .get("/stat", vValidator("query", StatQuerySchema), async (c) => {
      const { root } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      // Repeated `paths=` params, not comma-joined (see contract/fs.ts) — a
      // path with a literal comma must not be split.
      const list = c.req.queries("paths") ?? [];
      const entries = await Promise.all(
        list.map(async (path) => [path, (await resolveWorktreeFile(root, path)).ok] as const),
      );
      return c.json(Object.fromEntries(entries), 200);
    })
    .get("/raw", vValidator("query", RawQuerySchema), async (c) => {
      const { root, path } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const resolved = await resolveRawFile(root, path);
      if (!resolved.ok) return c.json(resolved.body, resolved.status);

      c.header("Content-Type", resolved.mime);
      c.header("Cache-Control", "no-store");
      // The whitelist in previewTypes.ts is what makes this endpoint safe to
      // embed directly (<img>/<iframe>) — nosniff stops a browser from
      // reinterpreting a mislabeled body as something else (e.g. HTML).
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(Bun.file(resolved.real).stream());
    })
    .post("/upload", vValidator("query", UploadQuerySchema), async (c) => {
      const { root, dir, overwrite } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      // Reject an oversized body before buffering it into formData().
      const contentLength = c.req.header("content-length");
      if (contentLength !== undefined && Number(contentLength) > MAX_UPLOAD_BYTES) {
        return c.json({ error: "too-large" as const }, 413);
      }

      const formData = await c.req.formData();
      const parts = formData.getAll("file").filter((p): p is File => p instanceof File);
      const files = await Promise.all(
        parts.map(async (part) => ({ name: part.name, data: await part.arrayBuffer() })),
      );

      const result = await importFiles({
        root,
        dir: dir ?? "",
        files,
        overwrite: overwrite === "true",
      });
      return c.json(result.body, result.status);
    })
    .post("/trash", vValidator("query", TrashQuerySchema), async (c) => {
      const { root, path } = c.req.valid("query");

      if (!(await isAllowed(root, allowedRoots))) {
        if (!(await exists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      if (isInvalidTrashPath(path)) {
        return c.json({ error: "invalid-path" as const }, 400);
      }

      const abs = join(root, path);
      const inside = await resolveInsideRoot(root, abs);
      if (!inside.ok) {
        return c.json({ error: inside.error }, inside.error === "not-found" ? 404 : 400);
      }

      // Checked against the resolved real path, not the raw `path`, so a
      // `.git`-into-symlink, a differently-cased `.GIT`, or a `root` pointed
      // inside `.git` itself can't slip past (see gitPath.ts).
      if (isGitInternalPath(inside.real)) {
        return c.json({ error: "forbidden-path" as const }, 400);
      }

      const result = await trasher.moveToTrash(inside.real);
      if (!result.ok) {
        if (result.reason === "no-backend") {
          return c.json({ error: "no-trash-backend" as const }, 501);
        }
        return c.json({ error: "trash-failed" as const, message: result.message }, 500);
      }

      return c.json({ trashed: path }, 200);
    });

  return app;
}
