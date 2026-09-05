// mime table for GET /api/git/raw, restricted to the extensions
// `previewKindForPath` (contract/preview.ts) accepts — the web decides
// image/pdf routing from that same list, so the two can't drift apart.

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

/** The `Content-Type` for a previewable path's extension, or `null` when the
 * extension isn't in the preview whitelist (caller should respond 415). */
export function previewMimeForPath(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? null;
}
