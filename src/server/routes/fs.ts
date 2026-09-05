import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { join } from "node:path";
import {
  FileQuerySchema,
  LsQuerySchema,
  RawQuerySchema,
  TrashQuerySchema,
  UploadQuerySchema,
} from "../../contract/fs";
import { listDir } from "../fs/ls";
import { readWorktreeFile } from "../fs/readFile";
import { resolveRawFile } from "../fs/rawFile";
import { resolveInsideRoot } from "../fs/resolveInsideRoot";
import { createTrasher, type Trasher } from "../fs/trash";
import { importFiles, MAX_UPLOAD_BYTES } from "../fs/upload";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface FsRoutesDeps {
  /** Absolute paths allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  /** POST /api/fs/trash's OS-trash backend; injected in tests. */
  trasher?: Trasher;
}

const isAllowed = isAllowedRoot;
const exists = pathExists;

function isInvalidTrashPath(path: string): boolean {
  if (path === "" || path.includes("\0")) return true;
  if (path.startsWith("/")) return true;
  return path.split("/").includes("..");
}

/** `.git` itself, or anything under it, is refused — trashing a repo's own
 * git directory (even to the recoverable OS trash) isn't a "file viewer"
 * operation and would desync the worktree from git's bookkeeping. */
function isGitPath(path: string): boolean {
  return path.split("/")[0] === ".git";
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
      if (isGitPath(path)) {
        return c.json({ error: "forbidden-path" as const }, 400);
      }

      const abs = join(root, path);
      const inside = await resolveInsideRoot(root, abs);
      if (!inside.ok) {
        return c.json({ error: inside.error }, inside.error === "not-found" ? 404 : 400);
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
