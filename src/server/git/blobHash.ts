import { createHash } from "node:crypto";

/**
 * Compute the git blob object hash for `buf`, i.e.
 * sha1("blob " + byteLength + "\0" + content), as full 40 hex chars.
 */
export function gitBlobHash(buf: Buffer): string {
  const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
  return createHash("sha1")
    .update(Buffer.concat([header, buf]))
    .digest("hex");
}
