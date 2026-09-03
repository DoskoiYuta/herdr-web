import type { Anchor, Side } from "../../../contract/review";

/** \r を除去し、行末の空白を trim する（アンカーの正規化規則） */
export function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").replace(/[ \t]+$/, "");
}

function hashAnchorText(before: string[], line: string, after: string[]): string {
  const text = [...before, line, ...after].join("\n");
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(text);
  return hasher.digest("hex");
}

/**
 * `lines` (未正規化でよい) の `lineIndex0`（0-based）番目の行から Anchor を組み立てる。
 * before/after は同じ side 上の最大 3 行。
 */
export function buildAnchor(lines: string[], lineIndex0: number, side: Side): Anchor {
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
    hash: hashAnchorText(before, line, after),
  };
}

export type AnchorLocation = { line: number; confidence: "exact" | "context" | "line" };

function matchesBefore(normalized: string[], i: number, before: string[]): boolean {
  const start = i - before.length;
  if (start < 0) return false;
  for (let k = 0; k < before.length; k++) {
    if (normalized[start + k] !== before[k]) return false;
  }
  return true;
}

function matchesAfter(normalized: string[], i: number, after: string[]): boolean {
  for (let k = 0; k < after.length; k++) {
    if (normalized[i + 1 + k] !== after[k]) return false;
  }
  return true;
}

function nearestToHint(indices: number[], lineHint: number): number {
  let best = indices[0]!;
  let bestDist = Math.abs(best + 1 - lineHint);
  for (const i of indices) {
    const dist = Math.abs(i + 1 - lineHint);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * `anchor` を現在の `lines`（未正規化でよい）上で再解決する。
 * 一致順位: (1) 行 + 前後コンテキスト完全一致 (2) 行 + 片側コンテキスト一致
 * (3) 行のみ一致（lineHint に最も近い出現を選ぶ）。
 * 見つからなければ null。
 */
export function locateAnchor(anchor: Anchor, lines: string[]): AnchorLocation | null {
  const normalized = lines.map(normalizeLine);
  const candidates: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === anchor.line) candidates.push(i);
  }
  if (candidates.length === 0) return null;

  const exact = candidates.filter(
    (i) => matchesBefore(normalized, i, anchor.before) && matchesAfter(normalized, i, anchor.after),
  );
  if (exact.length > 0) {
    return { line: nearestToHint(exact, anchor.lineHint) + 1, confidence: "exact" };
  }

  const context = candidates.filter(
    (i) =>
      (anchor.before.length > 0 && matchesBefore(normalized, i, anchor.before)) ||
      (anchor.after.length > 0 && matchesAfter(normalized, i, anchor.after)),
  );
  if (context.length > 0) {
    return { line: nearestToHint(context, anchor.lineHint) + 1, confidence: "context" };
  }

  return { line: nearestToHint(candidates, anchor.lineHint) + 1, confidence: "line" };
}
