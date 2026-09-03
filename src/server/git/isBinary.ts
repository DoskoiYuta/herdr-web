const SCAN_LIMIT = 8000;

/**
 * True iff `buf` looks like a binary file, i.e. it contains a NUL byte
 * within its first 8000 bytes (same heuristic git uses).
 */
export function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
