// Files タブの Markdown プレビュー編集 (MarkdownView) は Tiptap 経由で内容を
// 正規化した markdown を返す（リスト記号の統一、表の桁揃えなど）。それを
// そのまま保存すると触っていない行までフォーマットが変わり diff が荒れる
// ため、ディスク上の原文 (original) を基準に、実際に編集された範囲だけを
// 書き換える 3-way ラインマージをここで行う。
//
// 3 つの入力:
// - original:   ディスク上の markdown（編集前）
// - normalized: original を一度 Tiptap で往復した結果（= 編集開始時点の
//   エディタの初期シリアライズ）
// - edited:     ユーザーの編集後、Tiptap が返した markdown
//
// normalized から edited への差分（diffArrays 上の各ハンク）を original の
// 行範囲へ写し替える。ハンクの両端が original/normalized で内容が一致する
// 行（`buildOrigNormBlocks` の非正規化ブロック）に収まっていれば original
// のその範囲を edited の行で置き換え、書式は保たれる。ハンクが正規化で
// 書式の変わった行にかかっている場合は、その範囲を丸ごと edited 側の行で
// 置き換える（`normalizedRegions` を増やす）— original 側の対応行数が
// 正規化前後で変わりうる（例: `===` 見出し 2 行 → `#` 見出し 1 行）ため、
// 部分的な対応は取れない。
import { diffArrays } from "diff";

export interface MergeMarkdownEditInput {
  original: string;
  normalized: string;
  edited: string;
}

export interface MergeMarkdownEditResult {
  merged: string;
  /** 正規化された書式のまま出力された段落の数（保存はできるが、その段落は
   * ディスク上の書式と変わる）。 */
  normalizedRegions: number;
}

interface Block {
  normStart: number;
  normEnd: number;
  origStart: number;
  origEnd: number;
  /** true: この範囲は original → normalized で内容が変わった（書式が正規化
   * された）行 — original/normalized の行数が一致するとは限らない。 */
  wasNormalized: boolean;
}

function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function splitLines(s: string): string[] {
  return stripTrailingNewline(s).split("\n");
}

function buildOrigNormBlocks(originalLines: string[], normalizedLines: string[]): Block[] {
  const changes = diffArrays(originalLines, normalizedLines);
  const blocks: Block[] = [];
  let oi = 0;
  let ni = 0;
  for (let idx = 0; idx < changes.length; idx++) {
    const c = changes[idx];
    if (!c) continue;
    if (!c.added && !c.removed) {
      const len = c.value.length;
      blocks.push({
        normStart: ni,
        normEnd: ni + len,
        origStart: oi,
        origEnd: oi + len,
        wasNormalized: false,
      });
      oi += len;
      ni += len;
      continue;
    }
    if (c.removed) {
      const removedLen = c.value.length;
      const next = changes[idx + 1];
      const addedLen = next?.added ? next.value.length : 0;
      blocks.push({
        normStart: ni,
        normEnd: ni + addedLen,
        origStart: oi,
        origEnd: oi + removedLen,
        wasNormalized: true,
      });
      oi += removedLen;
      ni += addedLen;
      if (next?.added) idx++;
      continue;
    }
    // pure addition in normalized with no corresponding original text
    // (e.g. the serializer injects something original never had).
    const len = c.value.length;
    blocks.push({
      normStart: ni,
      normEnd: ni + len,
      origStart: oi,
      origEnd: oi,
      wasNormalized: true,
    });
    ni += len;
  }
  return blocks;
}

function blocksOverlapping(blocks: Block[], start: number, end: number): Block[] {
  return blocks.filter((b) => b.normEnd > start && b.normStart < end);
}

export function mergeMarkdownEdit({
  original,
  normalized,
  edited,
}: MergeMarkdownEditInput): MergeMarkdownEditResult {
  if (original === normalized) {
    return { merged: matchTrailingNewline(edited, original), normalizedRegions: 0 };
  }

  const originalLines = splitLines(original);
  const normalizedLines = splitLines(normalized);
  const editedLines = splitLines(edited);
  const blocks = buildOrigNormBlocks(originalLines, normalizedLines);

  const editChanges = diffArrays(normalizedLines, editedLines);
  const out: string[] = [];
  let normalizedRegions = 0;
  let ni = 0;

  for (let idx = 0; idx < editChanges.length; idx++) {
    const c = editChanges[idx];
    if (!c) continue;
    if (!c.added && !c.removed) {
      // Untouched by the user — restore original formatting wherever the
      // normalizer changed it.
      const len = c.value.length;
      const start = ni;
      const end = ni + len;
      const overlapping = blocksOverlapping(blocks, start, end);
      for (let bi = 0; bi < overlapping.length; bi++) {
        const b = overlapping[bi];
        if (!b) continue;
        if (b.normStart === b.normEnd) {
          // Zero-width in normalized space: the normalizer dropped this
          // original text outright (e.g. a YAML front-matter delimiter
          // absorbed into a heading) — it has no line the user could ever
          // have edited, so always restore it verbatim.
          out.push(...originalLines.slice(b.origStart, b.origEnd));
          continue;
        }
        const s = Math.max(b.normStart, start);
        const e = Math.min(b.normEnd, end);
        if (s >= e) continue;
        if (!b.wasNormalized) {
          out.push(
            ...originalLines.slice(
              b.origStart + (s - b.normStart),
              b.origStart + (e - b.normStart),
            ),
          );
          continue;
        }
        if (s !== b.normStart || e !== b.normEnd) {
          // Partial, untouched overlap with a reformatted block — no clean
          // original range to fall back to.
          out.push(...normalizedLines.slice(s, e));
          continue;
        }
        // The whole reformatted block sits inside this untouched chunk. A
        // pure insertion immediately following it (no removal — e.g. a new
        // list item typed after existing ones) has nothing else to attach
        // to and is treated as extending this block, which then counts as
        // touched: original formatting can't be preserved once part of the
        // block is edited-side content.
        const isBlockEnd = bi === overlapping.length - 1 && e === end;
        const next = isBlockEnd ? editChanges[idx + 1] : undefined;
        if (next?.added && !next.removed) {
          out.push(...normalizedLines.slice(b.normStart, b.normEnd), ...next.value);
          normalizedRegions++;
          idx++;
        } else {
          out.push(...originalLines.slice(b.origStart, b.origEnd));
        }
      }
      ni += len;
      continue;
    }
    if (c.removed) {
      const removedLen = c.value.length;
      const start = ni;
      const end = ni + removedLen;
      const next = editChanges[idx + 1];
      const newLines = next?.added ? next.value : [];
      // Zero-width blocks (see the untouched-chunk branch above) have no
      // line here to compare against — ignore them so one doesn't spoil the
      // single-block "clean" check below.
      const covering = blocksOverlapping(blocks, start, end).filter(
        (b) => b.normStart !== b.normEnd,
      );
      const clean =
        covering.length === 1 &&
        covering[0] !== undefined &&
        !covering[0].wasNormalized &&
        covering[0].normStart <= start &&
        covering[0].normEnd >= end;
      if (clean) {
        // The touched range sits entirely inside untouched-by-normalization
        // text — nothing else needs to change, so use the edited lines
        // verbatim without counting this as a normalized region.
        out.push(...newLines);
      } else {
        out.push(...newLines);
        normalizedRegions++;
      }
      ni += removedLen;
      if (next?.added) idx++;
      continue;
    }
    // Pure insertion (no removal) — genuinely new content, not a
    // reformatting artifact, EXCEPT for a trailing run of blank lines: a
    // table as the last block gets a blank paragraph appended by
    // ProseMirror's own schema fix-up once the document is mounted in a
    // live view (a detached/headless editor never does this), so it shows
    // up as an insertion `normalized` never had even with zero user edits.
    // A genuine trailing blank line from the user is indistinguishable from
    // this artifact and markdown treats one as insignificant either way, so
    // dropping it is the safer default.
    const isTrailingBlankRun =
      idx === editChanges.length - 1 && c.value.every((line) => line === "");
    if (!isTrailingBlankRun) out.push(...c.value);
  }

  return { merged: matchTrailingNewline(out.join("\n"), original), normalizedRegions };
}

function matchTrailingNewline(text: string, original: string): string {
  const withoutTrailing = stripTrailingNewline(text);
  return original.endsWith("\n") ? `${withoutTrailing}\n` : withoutTrailing;
}
