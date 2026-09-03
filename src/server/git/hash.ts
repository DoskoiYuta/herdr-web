import { createHash } from "node:crypto";

/** sha1 hex digest of `text`, truncated to the first 12 characters. */
export function sha1_12(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}
