import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";
import type { UploadErrorCode, UploadResponse } from "../../contract/fs";
import { resolveInsideRoot } from "./resolveInsideRoot";

/** Same total-request cap the route enforces via `content-length`. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface ImportFile {
  /** Path relative to `dir`, `/`-separated; may contain subdirectories. */
  name: string;
  data: Uint8Array | ArrayBuffer;
}

export type ImportFilesStatus = 200 | 400 | 404 | 409 | 413;

export interface ImportFilesResult {
  status: ImportFilesStatus;
  body:
    | UploadResponse
    | {
        error: Extract<UploadErrorCode, "invalid-path" | "outside-repo" | "not-a-file">;
        path: string;
      }
    | { error: "not-found" | "not-a-directory" }
    | { error: "exists"; paths: string[] }
    | { error: "too-large" };
}

/** `dir` may be `""` (the worktree root); everything else follows the same rules as file names. */
function isInvalidDir(dir: string): boolean {
  if (dir === "") return false;
  return isInvalidFileName(dir);
}

/** A dropped file's relative name: non-empty, no `..`/empty segments, not absolute. */
function isInvalidFileName(path: string): boolean {
  if (path === "" || path.includes("\0") || isAbsolute(path)) return true;
  const segments = path.split("/");
  return segments.some((s) => s === "" || s === "..");
}

function toData(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Pure decision + IO for POST /api/git/upload: write one batch of dropped
 * files under `dir`, git-agnostic. Validates every file up front (name,
 * destination containment, conflicts) and only starts writing once the
 * whole batch is known-good, so a rejected batch leaves nothing on disk.
 */
export async function importFiles(opts: {
  root: string;
  dir: string;
  files: ImportFile[];
  overwrite?: boolean;
}): Promise<ImportFilesResult> {
  const { root, dir, files, overwrite = false } = opts;

  const totalBytes = files.reduce((sum, f) => sum + toData(f.data).byteLength, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    return { status: 413, body: { error: "too-large" } };
  }

  if (isInvalidDir(dir)) {
    return { status: 400, body: { error: "invalid-path", path: dir } };
  }

  const absDir = dir === "" ? root : join(root, dir);
  const inside = await resolveInsideRoot(root, absDir);
  if (!inside.ok) {
    return {
      status: inside.error === "not-found" ? 404 : 400,
      body:
        inside.error === "not-found"
          ? { error: "not-found" }
          : { error: "outside-repo", path: dir },
    };
  }

  let dirStat: Awaited<ReturnType<typeof stat>>;
  try {
    dirStat = await stat(inside.real);
  } catch {
    return { status: 404, body: { error: "not-found" } };
  }
  if (!dirStat.isDirectory()) {
    return { status: 400, body: { error: "not-a-directory" } };
  }

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    realRoot = root;
  }
  const isContained = (real: string) => real === realRoot || real.startsWith(realRoot + sep);

  // Phase 1: validate the whole batch (name, destination containment,
  // directory-vs-file conflicts) before writing anything, so a batch that
  // fails partway through never leaves a partial write on disk.
  const destinations: { name: string; dest: string; existed: boolean }[] = [];
  for (const file of files) {
    if (isInvalidFileName(file.name)) {
      return { status: 400, body: { error: "invalid-path", path: file.name } };
    }

    const dest = join(inside.real, file.name);
    const parent = dirname(dest);
    try {
      await mkdir(parent, { recursive: true });
    } catch {
      return { status: 400, body: { error: "not-a-directory" } };
    }

    // A pre-existing symlink inside `dir` can point `parent` outside the
    // repo even though `dest` was built from a `..`-free relative name;
    // re-resolve after mkdir to catch that.
    let realParent: string;
    try {
      realParent = await realpath(parent);
    } catch {
      realParent = parent;
    }
    if (!isContained(realParent)) {
      return { status: 400, body: { error: "outside-repo", path: file.name } };
    }

    let existed = false;
    try {
      const destStat = await lstat(dest);
      existed = true;
      if (destStat.isDirectory()) {
        return { status: 400, body: { error: "not-a-file", path: file.name } };
      }
    } catch {
      existed = false;
    }
    destinations.push({ name: file.name, dest, existed });
  }

  if (!overwrite) {
    const conflicts = destinations.filter((d) => d.existed).map((d) => d.name);
    if (conflicts.length > 0) {
      return { status: 409, body: { error: "exists", paths: conflicts } };
    }
  }

  // Phase 2: everything validated, now write.
  const written: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const { dest } = destinations[i]!;
    await writeFile(dest, toData(file.data));
    written.push(file.name);
  }

  return { status: 200, body: { written } };
}
