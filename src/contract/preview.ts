// Extension list shared by the server (`/api/git/raw`'s mime whitelist) and
// the web (deciding whether to route a selected file to an image/PDF preview
// instead of `useFile`) so the two never drift apart.

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"];
const PDF_EXTENSIONS = ["pdf"];

function extensionOf(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Which preview a path gets from `/api/git/raw`, or `null` for none (falls
 * back to the text/binary viewer via `/api/git/file`). */
export function previewKindForPath(path: string): "image" | "pdf" | null {
  const ext = extensionOf(path);
  if (ext === null) return null;
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (PDF_EXTENSIONS.includes(ext)) return "pdf";
  return null;
}
