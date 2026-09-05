import type { RawErrorCode } from "../../contract/fs";
import { previewMimeForPath } from "./previewTypes";
import { resolveWorktreeFile } from "./readFile";

// Previews are meant for images/PDFs opened directly in the browser, not
// arbitrary large binaries — capped well above any real screenshot/PDF but
// far below something that would be worth streaming in chunks anyway.
export const MAX_RAW_BYTES = 50 * 1024 * 1024;

export type RawFileStatus = 400 | 404 | 413 | 415;

export type ResolveRawFileResult =
  | { ok: true; real: string; mime: string }
  | { ok: false; status: RawFileStatus; body: { error: RawErrorCode } };

/** Decision logic for GET /api/git/raw, minus the actual byte streaming
 * (left to the route so it can hand `Bun.file(real)` straight to the
 * response instead of buffering it here). */
export async function resolveRawFile(root: string, path: string): Promise<ResolveRawFileResult> {
  const mime = previewMimeForPath(path);
  if (mime === null) {
    return { ok: false, status: 415, body: { error: "unsupported" } };
  }

  const resolved = await resolveWorktreeFile(root, path);
  if (!resolved.ok) {
    // resolveWorktreeFile never returns 403 (that's the allowed-roots check,
    // done by the route before this runs) — narrow its 400/404 subset here.
    return { ok: false, status: resolved.status as 400 | 404, body: { error: resolved.error } };
  }

  if (resolved.size > MAX_RAW_BYTES) {
    return { ok: false, status: 413, body: { error: "too-large" } };
  }

  return { ok: true, real: resolved.real, mime };
}
