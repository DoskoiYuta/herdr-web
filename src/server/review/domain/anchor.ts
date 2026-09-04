import type { Anchor, Side } from "../../../contract/review";

/** \r を除去し、行末の空白を trim する（アンカーの正規化規則） */
export function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").replace(/[ \t]+$/, "");
}

function hashAnchorText(before: string[], lines: string[], after: string[]): string {
  const text = [...before, ...lines, ...after].join("\n");
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(text);
  return hasher.digest("hex");
}

/**
 * `lines` (未正規化でよい) の `startIndex0..endIndex0`（0-based, 両端含む）番目の
 * 選択範囲から Anchor を組み立てる。before/after は同じ side 上の最大 3 行。
 */
export function buildAnchor(
  lines: string[],
  startIndex0: number,
  endIndex0: number,
  side: Side,
): Anchor {
  const normalized = lines.map(normalizeLine);
  const before = normalized.slice(Math.max(0, startIndex0 - 3), startIndex0);
  const selected = normalized.slice(startIndex0, endIndex0 + 1);
  const after = normalized.slice(endIndex0 + 1, endIndex0 + 4);
  return {
    side,
    lines: selected,
    before,
    after,
    lineHint: startIndex0 + 1,
    hash: hashAnchorText(before, selected, after),
  };
}

export type AnchorLocation = {
  line: number;
  span: number;
  confidence: "exact" | "context" | "line";
};

function blockMatchesAt(normalized: string[], i: number, block: string[]): boolean {
  if (i + block.length > normalized.length) return false;
  for (let k = 0; k < block.length; k++) {
    if (normalized[i + k] !== block[k]) return false;
  }
  return true;
}

function matchesBefore(normalized: string[], i: number, before: string[]): boolean {
  const start = i - before.length;
  if (start < 0) return false;
  for (let k = 0; k < before.length; k++) {
    if (normalized[start + k] !== before[k]) return false;
  }
  return true;
}

function matchesAfter(normalized: string[], i: number, blockLen: number, after: string[]): boolean {
  const start = i + blockLen;
  for (let k = 0; k < after.length; k++) {
    if (normalized[start + k] !== after[k]) return false;
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
 * 一致順位: (1) 選択範囲全体 + 前後コンテキスト完全一致 (2) 選択範囲全体 + 片側コンテキスト一致
 * (3) 選択範囲全体のみ一致（lineHint に最も近い出現を選ぶ）。
 * 選択範囲全体がどこにも一致しなければ、先頭行だけの一致にフォールバックする（span=1）。
 * それも見つからなければ null。
 */
export function locateAnchor(anchor: Anchor, lines: string[]): AnchorLocation | null {
  const normalized = lines.map(normalizeLine);
  const blockLen = anchor.lines.length;

  const candidates: number[] = [];
  for (let i = 0; i <= normalized.length - blockLen; i++) {
    if (blockMatchesAt(normalized, i, anchor.lines)) candidates.push(i);
  }

  if (candidates.length > 0) {
    const exact = candidates.filter(
      (i) =>
        matchesBefore(normalized, i, anchor.before) &&
        matchesAfter(normalized, i, blockLen, anchor.after),
    );
    if (exact.length > 0) {
      return {
        line: nearestToHint(exact, anchor.lineHint) + 1,
        span: blockLen,
        confidence: "exact",
      };
    }

    const context = candidates.filter(
      (i) =>
        (anchor.before.length > 0 && matchesBefore(normalized, i, anchor.before)) ||
        (anchor.after.length > 0 && matchesAfter(normalized, i, blockLen, anchor.after)),
    );
    if (context.length > 0) {
      return {
        line: nearestToHint(context, anchor.lineHint) + 1,
        span: blockLen,
        confidence: "context",
      };
    }

    return {
      line: nearestToHint(candidates, anchor.lineHint) + 1,
      span: blockLen,
      confidence: "line",
    };
  }

  // 選択範囲全体はどこにも無いが、先頭行だけなら見つかるかもしれない (弱い一致)。
  const first = anchor.lines[0];
  const firstCandidates: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === first) firstCandidates.push(i);
  }
  if (firstCandidates.length === 0) return null;

  return { line: nearestToHint(firstCandidates, anchor.lineHint) + 1, span: 1, confidence: "line" };
}
