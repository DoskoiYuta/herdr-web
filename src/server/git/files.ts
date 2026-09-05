import { lstat, readlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FilesErrorCode, FilesResponse } from "../../contract/git";
import { gitBlobHash } from "./blobHash";
import { catFileBlob, runGit } from "./run";
import { isBinary } from "./isBinary";
import { resolveInsideRoot } from "../fs/resolveInsideRoot";

const HASH_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

export interface ResolveFilesParams {
  root: string;
  path: string | null | undefined;
  prev?: string | null;
  type: string | null | undefined;
  oldHash?: string | null;
  newHash?: string | null;
}

export type ResolveFilesStatus = 200 | 400 | 404 | 409 | 500;

export interface ResolveFilesResult {
  status: ResolveFilesStatus;
  body: FilesResponse | { error: FilesErrorCode };
}

function normalizeCRLF(buf: Buffer): Buffer {
  return Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

/**
 * Try to compute the *filtered* (attribute-aware, e.g. autocrlf/text=auto)
 * git blob hash for `contents` as if it lived at `path` in `root`. Returns
 * null on any failure so callers can fall back to a stale/409 response.
 */
async function filteredHashObject(
  root: string,
  path: string,
  contents: Buffer,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(["hash-object", "--stdin", "--path", path], {
      cwd: root,
      input: contents,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Pure decision + IO for GET /api/git/files. */
export async function resolveFiles({
  root,
  path,
  prev = null,
  type,
  oldHash = null,
  newHash = null,
}: ResolveFilesParams): Promise<ResolveFilesResult> {
  if (!path || path.includes("\0")) {
    return { status: 400, body: { error: "invalid-path" } };
  }
  if (oldHash && !HASH_RE.test(oldHash)) {
    return { status: 400, body: { error: "invalid-hash" } };
  }
  if (newHash && !HASH_RE.test(newHash)) {
    return { status: 400, body: { error: "invalid-hash" } };
  }

  let oldFile: FilesResponse["oldFile"] = null;
  if (type !== "new" && oldHash) {
    const buf = await catFileBlob(root, oldHash);
    if (buf !== null) {
      if (isBinary(buf)) return { status: 500, body: { error: "binary" } };
      oldFile = {
        name: prev ?? path,
        contents: buf.toString("utf8"),
        cacheKey: `${oldHash}:${prev ?? path}`,
      };
    }
  }

  let newFile: FilesResponse["newFile"] = null;
  if (type !== "deleted" && newHash) {
    let buf = await catFileBlob(root, newHash);
    let effectiveHash = newHash;

    if (buf === null) {
      const abs = join(root, path);

      let st;
      try {
        st = await lstat(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return { status: 404, body: { error: "not-found" } };
        }
        throw err;
      }

      if (st.isSymbolicLink()) {
        // git hashes a symlink's *target string*, not its dereferenced
        // content. Serve that directly; the outside-repo containment check
        // does not apply because we never read through the link.
        const target = await readlink(abs);
        const contents = Buffer.from(target, "utf8");
        const computedHash = gitBlobHash(contents);
        if (computedHash !== newHash) {
          return { status: 409, body: { error: "stale" } };
        }
        buf = contents;
        effectiveHash = computedHash;
      } else {
        const inside = await resolveInsideRoot(root, abs);
        if (!inside.ok) {
          return {
            status: inside.error === "not-found" ? 404 : 400,
            body: { error: inside.error },
          };
        }
        const realAbs = inside.real;

        let contents: Buffer;
        try {
          contents = await readFile(realAbs);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return { status: 404, body: { error: "not-found" } };
          }
          throw err;
        }

        const computedHash = gitBlobHash(contents);
        if (computedHash !== newHash) {
          const filteredHash = await filteredHashObject(root, path, contents);
          if (filteredHash !== null && filteredHash === newHash) {
            // The hash-object --path match proves the *filtered* content's
            // hash equals newHash, not that our CRLF normalization
            // reproduces that filtered content (a filter=upper or LFS clean
            // filter would differ from plain CRLF normalization). Re-verify
            // by hashing the normalized content ourselves; only serve it
            // when that also matches.
            const normalized = normalizeCRLF(contents);
            if (gitBlobHash(normalized) === newHash) {
              contents = normalized;
              effectiveHash = newHash;
            } else {
              return { status: 409, body: { error: "stale" } };
            }
          } else {
            return { status: 409, body: { error: "stale" } };
          }
        } else {
          effectiveHash = computedHash;
        }
        buf = contents;
      }
    }

    if (isBinary(buf)) return { status: 500, body: { error: "binary" } };
    newFile = {
      name: path,
      contents: buf.toString("utf8"),
      cacheKey: `${effectiveHash}:${path}`,
    };
  }

  return { status: 200, body: { oldFile, newFile } };
}
