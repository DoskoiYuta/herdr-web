// Reimplementation of @pierre/trees' own row ordering (path-store/src/sort.ts:
// createSegmentSortKey / compareNaturalTokens / compareSegmentSortKeys) —
// case-insensitive, with runs of digits compared numerically rather than
// character-by-character (so "file2" sorts before "file10"). Diff's
// buildTree (tree.ts) computes its own nested tree for right-pane/j-k order
// independently of the PathTree component actually rendering the left list,
// so the two must be kept in sync by hand: a naive `<` comparison there
// disagrees with PathTree's library-driven order on mixed-case or numbered
// names.
type NaturalToken = string | number;

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function splitIntoNaturalTokens(value: string): NaturalToken[] {
  const tokens: NaturalToken[] = [];
  let tokenStart = 0;
  let index = 0;
  while (index < value.length) {
    while (index < value.length && !isDigit(value[index]!)) index += 1;
    if (index >= value.length) break;
    if (index > tokenStart) tokens.push(value.slice(tokenStart, index));
    let numberValue = 0;
    while (index < value.length && isDigit(value[index]!)) {
      numberValue = numberValue * 10 + (value.charCodeAt(index) - 48);
      index += 1;
    }
    tokens.push(numberValue);
    tokenStart = index;
  }
  if (tokenStart < value.length || tokens.length === 0) tokens.push(value.slice(tokenStart));
  return tokens;
}

function compareNaturalTokens(left: NaturalToken[], right: NaturalToken[]): number {
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) {
    const l = left[i]!;
    const r = right[i]!;
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "number") return l < r ? -1 : 1;
    const ls = String(l);
    const rs = String(r);
    if (ls !== rs) return ls < rs ? -1 : 1;
  }
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return 0;
}

/** Same ordering @pierre/trees applies to sibling rows: case-insensitive,
 * numeric-aware, falling back to the original (case-sensitive) string only
 * to break an exact tie. */
export function compareNatural(left: string, right: string): number {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftTokens = splitIntoNaturalTokens(leftLower);
  const rightTokens = splitIntoNaturalTokens(rightLower);

  if (
    leftTokens.length === 1 &&
    rightTokens.length === 1 &&
    typeof leftTokens[0] === "string" &&
    typeof rightTokens[0] === "string"
  ) {
    if (leftLower === rightLower) return left === right ? 0 : left < right ? -1 : 1;
    return leftLower < rightLower ? -1 : 1;
  }

  const tokenComparison = compareNaturalTokens(leftTokens, rightTokens);
  if (tokenComparison !== 0) return tokenComparison;
  if (leftLower !== rightLower) return leftLower < rightLower ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}
