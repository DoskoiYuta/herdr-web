// Line-level model of front matter content (the part between the `---`
// delimiters, see @/lib/frontMatter.ts). Deliberately not a YAML parser: it
// only recognizes `key: value` lines and their indented/`- `-prefixed
// continuation lines, treating everything else as opaque text. This keeps
// unedited lines byte-identical on round-trip and avoids taking on a YAML
// dependency just to render a key/value table.

export type FrontMatterEntry =
  | { kind: "kv"; key: string; sep: string; value: string; raw: string }
  | { kind: "raw"; text: string };

const KV_START = /^([^\s#:][^:]*?)(\s*:\s*)(.*)$/;

function isContinuation(line: string): boolean {
  return line.startsWith(" ") || line.startsWith("\t") || line.startsWith("- ");
}

export function parseFrontMatterEntries(inner: string): FrontMatterEntry[] {
  const lines = inner.split("\n");
  const entries: FrontMatterEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const match = KV_START.exec(line);
    if (match) {
      const [, key = "", sep = "", firstValue = ""] = match;
      let value = firstValue;
      let raw = line;
      let j = i + 1;
      while (j < lines.length && isContinuation(lines[j] ?? "")) {
        const continuationLine = lines[j] ?? "";
        value += `\n${continuationLine}`;
        raw += `\n${continuationLine}`;
        j++;
      }
      entries.push({ kind: "kv", key, sep, value, raw });
      i = j;
    } else {
      entries.push({ kind: "raw", text: line });
      i++;
    }
  }
  return entries;
}

export function serializeFrontMatterEntries(entries: FrontMatterEntry[]): string {
  return entries
    .filter((entry) => !(entry.kind === "kv" && entry.key === "" && entry.value === ""))
    .map((entry) => (entry.kind === "kv" ? `${entry.key}${entry.sep}${entry.value}` : entry.text))
    .join("\n");
}
