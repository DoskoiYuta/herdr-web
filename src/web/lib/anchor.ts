/**
 * Client-side mirror of `src/server/review/domain/anchor.ts`'s `buildAnchor`.
 * Must produce byte-for-byte the same `Anchor` shape (plan.md §F5-2) —
 * parity is asserted by `src/server/review/domain/anchor-parity.test.ts`,
 * which imports both implementations.
 *
 * The only difference from the server version is the hash primitive: the
 * server uses `Bun.CryptoHasher`; the browser has no such global, so this
 * uses the Web Crypto `crypto.subtle.digest("SHA-1", ...)` API, which is
 * async — so `buildAnchor` here returns a Promise where the server's is
 * synchronous.
 */
import type { Anchor, Side } from "@contract/review";

/** \r を除去し、行末の空白を trim する（アンカーの正規化規則） */
export function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").replace(/[ \t]+$/, "");
}

async function hashAnchorText(before: string[], line: string, after: string[]): Promise<string> {
  const text = [...before, line, ...after].join("\n");
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `lines` (未正規化でよい) の `lineIndex0`（0-based）番目の行から Anchor を組み立てる。
 * before/after は同じ side 上の最大 3 行。
 */
export async function buildAnchor(
  lines: string[],
  lineIndex0: number,
  side: Side,
): Promise<Anchor> {
  const normalized = lines.map(normalizeLine);
  const before = normalized.slice(Math.max(0, lineIndex0 - 3), lineIndex0);
  const line = normalized[lineIndex0] ?? "";
  const after = normalized.slice(lineIndex0 + 1, lineIndex0 + 4);
  return {
    side,
    line,
    before,
    after,
    lineHint: lineIndex0 + 1,
    hash: await hashAnchorText(before, line, after),
  };
}
