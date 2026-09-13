// Files タブの Markdown プレビュー編集 (MarkdownView) は Tiptap 経由で内容を
// 正規化した markdown を返す（リスト記号の統一、表の桁揃え、front matter や
// 生 HTML の破壊など）。それをそのまま保存すると触っていない行までフォーマ
// ットが変わり diff が荒れるため、ディスク上の原文 (original) を基準に、
// 実際に編集された範囲だけを書き換える 3-way ラインマージをここで行う。
//
// 3 つの入力:
// - original:   ディスク上の markdown（編集前、LF 化済み）
// - normalized: original を一度 Tiptap で往復した結果（= 編集開始時点の
//   エディタの初期シリアライズ）
// - edited:     ユーザーの編集後、Tiptap が返した markdown
//
// アルゴリズムは「対応付け + 領域吸収」の 2 段:
//   1. original の行と normalized の行を diffArrays で対応付け、一致した
//      行のペア（アンカー）の間を「正規化で変わった領域」として列挙する
//      （`diffToRegions`）。hunk の形（removed の直後に added が来る、等）
//      を仮定しない — 空行が偶然一致してアンカーになるだけで領域は 2 つに
//      分かれてよく、そのまま扱う。
//      1. の領域は、1 つの一致行（多くは空行）だけで隣り合う 2 領域に割れ
//      ていることがある（diffArrays の LCS が、書式が丸ごと消えた部分と
//      丸ごと現れた部分の間にある偶然一致する空行をアンカーに選ぶため）。
//      これを跨いだ編集は「表が二重に残る」ように壊れるので、そのような
//      隣接領域は 1 つに統合しておく（`mergeBlankAnchoredRegions`）。
//   2. normalized と edited を同じ関数で対応付け、非一致の領域＝ユーザーの
//      編集ハンクを得る。各ハンクが 1. の領域と（幅 > 0 で）重なっていれ
//      ば、重なった領域をすべて含むまでハンクを拡張し、その範囲を丸ごと
//      edited 側の内容へ置き換える（`normalizedRegions` を 1 増やす。表の
//      パディングなど original に無かった余分な空行は端で切り詰める）。
//      重ならなければ original の対応範囲へそのまま写す（正規化なし）。
//      幅ゼロの挿入が非吸収の境界に接する場合、それがリスト項目なら
//      隣接する original 側の記号に揃える（`fixListMarkers`）。
// 出力は original の行配列を土台にし、ハンクの当たった範囲だけを置き換え
// る——触っていない行は original の写像を経由せず、配列そのものがそのまま
// 残るので、`edited === normalized` なら常に `merged === original`（末尾
// 改行を除く）になる。
import { diffArrays } from "diff";

export interface MergeMarkdownEditInput {
  original: string;
  normalized: string;
  edited: string;
  /** `buildMarkdownCorrespondence(original, normalized)` の結果。渡せば
   * original↔normalized の対応付け（diffArrays 1 回分）を使い回す — 同じ
   * プレビュー編集セッション中は original/normalized が変わらないため、
   * キー入力のたびに再計算する必要が無い。省略時はこの呼び出し内で計算
   * する。 */
  correspondence?: MarkdownCorrespondence;
}

export interface MergeMarkdownEditResult {
  merged: string;
  /** 正規化された書式のまま出力された段落の数（保存はできるが、その段落は
   * ディスク上の書式と変わる）。 */
  normalizedRegions: number;
}

/** `from` の行範囲 `[fromStart, fromEnd)` と `to` の行範囲
 * `[toStart, toEnd)` が対応する「変わった領域」。どちらかの幅が 0 でもよい
 * （純粋な挿入・削除）。連続する一致行（アンカー）どうしの間がそのまま 1
 * 領域になる — 一致行を挟むなら領域は分かれる。 */
interface Region {
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
}

export interface MarkdownCorrespondence {
  oLines: string[];
  nLines: string[];
  /** original → normalized の変化領域。`from`=original 行番号、
   * `to`=normalized 行番号。 */
  onRegions: Region[];
}

function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function splitLines(s: string): string[] {
  return stripTrailingNewline(s).split("\n");
}

/** `diffArrays(fromLines, toLines)` の一致行をアンカーとして、非一致の
 * 連続区間をひとつの `Region` にまとめる。一致行（空文字列を含む）を挟め
 * ば、たとえ隣接していても別領域になる — hunk の形を仮定しないための
 * 核心部分。 */
function diffToRegions(fromLines: string[], toLines: string[]): Region[] {
  const changes = diffArrays(fromLines, toLines);
  const regions: Region[] = [];
  let fromIdx = 0;
  let toIdx = 0;
  let pending: Region | null = null;
  for (const c of changes) {
    if (!c.added && !c.removed) {
      if (pending) {
        regions.push(pending);
        pending = null;
      }
      fromIdx += c.value.length;
      toIdx += c.value.length;
      continue;
    }
    if (!pending) pending = { fromStart: fromIdx, fromEnd: fromIdx, toStart: toIdx, toEnd: toIdx };
    if (c.removed) {
      pending.fromEnd += c.value.length;
      fromIdx += c.value.length;
    } else {
      pending.toEnd += c.value.length;
      toIdx += c.value.length;
    }
  }
  if (pending) regions.push(pending);
  return regions;
}

/** Two reformatted regions that sit right next to each other, split only by
 * a single blank-line anchor, are almost always one reformatting that
 * `diffArrays`'s LCS happened to pin on that blank line rather than really
 * treating it as stable, untouched content — blank lines are frequent and
 * interchangeable, so the anchor it picks is not necessarily the
 * "intended" one. Left unmerged, a table reformatted at the very start of
 * a paragraph run splits into an "original, now gone" region and a
 * "normalized, newly appeared" region around that single blank line; an
 * edit landing on the normalized side then maps to a nonsensical
 * (sometimes empty, sometimes negative-offset) original range instead of
 * the whole original table, duplicating it in the output. Merging keeps
 * `mergeMarkdownEdit` a single pass over well-formed, non-overlapping
 * regions regardless of where `diffArrays` drew this particular line. */
function mergeBlankAnchoredRegions(regions: Region[], fromLines: string[]): Region[] {
  const merged: Region[] = [];
  for (const r of regions) {
    const prev = merged[merged.length - 1];
    const gap = prev ? r.fromStart - prev.fromEnd : -1;
    if (prev && gap === 1 && fromLines[prev.fromEnd] === "") {
      prev.fromEnd = r.fromEnd;
      prev.toEnd = r.toEnd;
      continue;
    }
    merged.push({ ...r });
  }
  return merged;
}

/** `fromPos`（`regions` のどの領域の内部にも無い位置）を `to` 空間の対応
 * する位置へ写す。領域の外側では from/to は同じ歩幅で進むので、それまでに
 * 「通過した」領域のオフセットの合計がそのまま効く。
 *
 * 領域は「通過した」とみなせれば（`r.fromEnd < fromPos`、明確にその先）
 * 常にオフセットへ足す。`fromPos` がちょうどある領域の端に一致する場合だけ
 * 特別扱いする: その領域が `to` 側で幅ゼロ（正規化で行が丸ごと消えた等）
 * なら、境界が「その手前」か「その先」か区別できないので、まだ通過してい
 * ないもの＝含めない、として扱う（同じ端に一致する隣の実在領域が正しく
 * 続けて処理されるよう、ループ自体は打ち切らない）。幅がある領域なら、
 * 端に一致した時点で確実に「通過した」と言えるので含める。 */
function mapForward(regions: Region[], fromPos: number): number {
  let offset = 0;
  for (const r of regions) {
    if (r.fromEnd > fromPos) break;
    if (r.fromEnd === fromPos && r.fromStart === r.fromEnd) continue;
    offset = r.toEnd - r.fromEnd;
  }
  return fromPos + offset;
}

/** `mapForward` の逆方向: `toPos` を `from` 空間へ写す。
 *
 * `treatZeroWidthTouchAsPassed` は `to` 側幅ゼロの領域（正規化で行が丸ごと
 * 消えた区間、例: front matter や HTML コメント直後の空行）にちょうど端が
 * 一致したときの扱いを呼び出し側に選ばせる。hunk の開始端は常に true（＝
 * その消えた行は編集対象に含めない＝領域の後ろに写す）で呼ぶ — false のまま
 * だと、消えた行が hunk の直前にあるだけでその行ごと置換範囲に呑み込まれる
 * （見出し直前の空行が、見出しを編集するたびに消える不具合の原因だった）。
 * hunk の終了端は、置換（幅がある）なら false（領域の手前）、純粋な挿入
 * （幅ゼロ）なら true（開始端と同じ）で呼ぶ。 */
function mapBackward(
  regions: Region[],
  toPos: number,
  treatZeroWidthTouchAsPassed: boolean,
): number {
  let offset = 0;
  for (const r of regions) {
    if (r.toEnd > toPos) break;
    if (r.toEnd === toPos && r.toStart === r.toEnd && !treatZeroWidthTouchAsPassed) continue;
    offset = r.fromEnd - r.toEnd;
  }
  return toPos + offset;
}

function countLeadingBlanks(lines: string[]): number {
  let n = 0;
  while (n < lines.length && lines[n] === "") n++;
  return n;
}

function countTrailingBlanks(lines: string[]): number {
  let n = 0;
  while (n < lines.length && lines[lines.length - 1 - n] === "") n++;
  return n;
}

const LIST_ITEM = /^(\s*)([-*+])( .*)$/;

/** 幅ゼロの挿入（正規化領域の外）がリスト項目で、挿入位置に隣接する
 * original 側の行も別記号のリスト項目なら、記号を隣接行に合わせる —
 * 「`- z` を `* a` の前に挿入すると `* z` になる」。それ以外はそのまま。 */
function fixListMarkers(lines: string[], oLines: string[], oPos: number): string[] {
  const after = oLines[oPos];
  const before = oLines[oPos - 1];
  const adjacent = after !== undefined && LIST_ITEM.test(after) ? after : before;
  const adjacentMatch = adjacent !== undefined ? LIST_ITEM.exec(adjacent) : null;
  if (!adjacentMatch) return lines;
  const marker = adjacentMatch[2];
  return lines.map((line) => {
    const m = LIST_ITEM.exec(line);
    if (!m || m[2] === marker) return line;
    return `${m[1]}${marker}${m[3]}`;
  });
}

export function buildMarkdownCorrespondence(
  original: string,
  normalized: string,
): MarkdownCorrespondence {
  const oLines = splitLines(original);
  const nLines = splitLines(normalized);
  const onRegions = mergeBlankAnchoredRegions(diffToRegions(oLines, nLines), oLines);
  return { oLines, nLines, onRegions };
}

export function mergeMarkdownEdit({
  original,
  normalized,
  edited,
  correspondence,
}: MergeMarkdownEditInput): MergeMarkdownEditResult {
  const { oLines, nLines, onRegions } =
    correspondence ?? buildMarkdownCorrespondence(original, normalized);
  const eLines = splitLines(edited);
  const neRegions = diffToRegions(nLines, eLines);

  let normalizedRegions = 0;
  const edits: { oStart: number; oEnd: number; lines: string[] }[] = [];

  for (const hunk of neRegions) {
    let curStart = hunk.fromStart;
    let curEnd = hunk.fromEnd;
    // Expand [curStart, curEnd) until it fully contains every original↔
    // normalized region it *strictly* overlaps (landing partway inside, or
    // bridging two separated by a coincidentally matching blank line) —
    // there is no reliable 1:1 line mapping inside such a region, so once a
    // hunk touches any part of it the whole region must be swallowed.
    // Merely *touching* a region's edge (no interior overlap) never counts
    // here — `mapBackward`/`mapForward` below already do the right thing
    // for that on their own (see their comments), and treating a touch as
    // absorption would needlessly reformat text the user never edited.
    let absorbedAny = false;
    for (;;) {
      const overlapping = onRegions.filter((r) => r.toEnd > curStart && r.toStart < curEnd);
      if (overlapping.length === 0) break;
      absorbedAny = true;
      const newStart = Math.min(curStart, ...overlapping.map((r) => r.toStart));
      const newEnd = Math.max(curEnd, ...overlapping.map((r) => r.toEnd));
      if (newStart === curStart && newEnd === curEnd) break;
      curStart = newStart;
      curEnd = newEnd;
    }

    const oStart = mapBackward(onRegions, curStart, true);
    const oEnd = mapBackward(onRegions, curEnd, curStart === curEnd);
    // A boundary that the extension loop never moved away from the hunk's
    // own edge must use that edge's own (already known) edited-space value
    // rather than `mapForward`. This matters only for a pure insertion
    // (fromStart === fromEnd): mapping curStart and curEnd would both land
    // on the very same position — there is no "before" or "after" the
    // insertion to distinguish by position alone, so the mapping always
    // collapses to an empty slice regardless of how boundary-touching
    // regions are handled.
    const eStart = curStart === hunk.fromStart ? hunk.toStart : mapForward(neRegions, curStart);
    const eEnd = curEnd === hunk.fromEnd ? hunk.toEnd : mapForward(neRegions, curEnd);
    let lines = eLines.slice(eStart, eEnd);

    const isPureInsertion = hunk.fromStart === hunk.fromEnd;
    if (isPureInsertion && !absorbedAny) {
      lines = fixListMarkers(lines, oLines, oStart);
    }
    if (absorbedAny) {
      // Tiptap pads blocks (tables especially) with more blank lines than
      // the original had at that edge — trim the edited replacement's
      // leading/trailing blank run down to however many blank lines the
      // *original* absorbed range itself had there, rather than assuming
      // "0 or 1". A table absorbed together with its one trailing blank
      // line (because that line doubled as the anchor splitting the
      // reformatting into two regions — see `mergeBlankAnchoredRegions`)
      // must keep exactly that one blank, not zero and not the two or
      // three Tiptap likes to pad it with.
      const originalSlice = oLines.slice(oStart, oEnd);
      const excessLead = countLeadingBlanks(lines) - countLeadingBlanks(originalSlice);
      if (excessLead > 0) lines = lines.slice(excessLead);
      const excessTrail = countTrailingBlanks(lines) - countTrailingBlanks(originalSlice);
      if (excessTrail > 0) lines = lines.slice(0, lines.length - excessTrail);
      normalizedRegions++;
    }
    edits.push({ oStart, oEnd, lines });
  }

  // Apply back-to-front so each edit's oStart/oEnd stays valid regardless of
  // how earlier (in document order) edits change the array's length.
  const result = [...oLines];
  for (const edit of [...edits].sort((a, b) => b.oStart - a.oStart)) {
    result.splice(edit.oStart, edit.oEnd - edit.oStart, ...edit.lines);
  }

  return { merged: matchTrailingNewline(result.join("\n"), original), normalizedRegions };
}

/** `text` is always `result.join("\n")` for a `result` derived from
 * `splitLines(original)` (i.e. already exactly `stripTrailingNewline(original)`
 * apart from spliced-in edits) — so restoring the trailing newline original
 * had is a plain conditional append, never a strip-then-add (stripping
 * first would eat a genuine blank line when original ends with two or more
 * newlines). */
function matchTrailingNewline(text: string, original: string): string {
  return original.endsWith("\n") ? `${text}\n` : text;
}
