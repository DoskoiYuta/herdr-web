// Shared PathTree row-decoration colors for +additions/-deletions stats
// (Diff and Graph's commit file tree). @pierre/trees applies `color` as a
// raw inline style (see node_modules/@pierre/trees/dist/render/FileTreeView.js),
// not a Tailwind class, so these must be literal CSS colors rather than
// utility class names.
export const ADDITIONS_COLOR = "#059669"; // emerald-600
export const DELETIONS_COLOR = "#dc2626"; // red-600

export interface DecorationPart {
  text: string;
  color?: string;
}

/** @pierre/trees renders each decoration part as its own adjacent `<span>`
 * with no separator (FileTreeView.js's renderRowDecoration) — a plain-text
 * `text` field can join with `" "`, but `parts` themselves render pressed
 * together (e.g. "+4M") unless a space is inserted as its own part. */
export function joinDecorationParts(parts: DecorationPart[]): DecorationPart[] {
  const out: DecorationPart[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ text: " " });
    out.push(part);
  });
  return out;
}
