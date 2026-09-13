// YAML front matter (Jekyll/Hugo style, RFC-less convention) is not
// something @tiptap/markdown (parser: marked) understands — it renders the
// `---` fences as headings and corrupts them on any round-trip (upstream
// issue tiptap-editor/tiptap#7152, closed without a fix planned). Splitting
// it out so callers can keep it out of the Tiptap document entirely is
// cheaper and more robust than teaching the editor about it.
//
// Deliberately does not parse the YAML itself — front matter content is
// opaque text here, preserved byte-for-byte.

export interface SplitFrontMatter {
  /** Raw text of the front matter block, delimiters included, up to and
   * including the closing delimiter line's own trailing newline (or to the
   * end of the string if that line has none). `null` when the input has no
   * front matter. */
  frontMatter: string | null;
  /** Everything after `frontMatter` (or the whole input, when there is
   * none). */
  body: string;
}

const DELIMITER_LINE = /^(?:---|\.\.\.)$/;

/** A front matter block requires the first line to be exactly `---` and a
 * later line that is exactly `---` or `...`. Anything else (no opening
 * fence, a blank line before it, no closing fence) is treated as plain
 * markdown with no front matter. */
export function splitFrontMatter(markdown: string): SplitFrontMatter {
  const firstNewline = markdown.indexOf("\n");
  const firstLine = firstNewline === -1 ? markdown : markdown.slice(0, firstNewline);
  if (firstLine !== "---" || firstNewline === -1) {
    return { frontMatter: null, body: markdown };
  }

  let pos = firstNewline + 1;
  while (pos <= markdown.length) {
    const nextNewline = markdown.indexOf("\n", pos);
    const line = nextNewline === -1 ? markdown.slice(pos) : markdown.slice(pos, nextNewline);
    if (DELIMITER_LINE.test(line)) {
      const end = nextNewline === -1 ? markdown.length : nextNewline + 1;
      return { frontMatter: markdown.slice(0, end), body: markdown.slice(end) };
    }
    if (nextNewline === -1) break;
    pos = nextNewline + 1;
  }
  return { frontMatter: null, body: markdown };
}

export function joinFrontMatter(frontMatter: string | null, body: string): string {
  return frontMatter === null ? body : frontMatter + body;
}
