// Displays/edits YAML front matter outside the Tiptap document (see
// @/lib/frontMatter.ts for why it can't live inside Tiptap). Delimiter
// lines are shown but not editable — only the content between them is,
// rendered as a key/value table via @/lib/frontMatterEntries (line-level
// model, not a YAML parser) so untouched lines stay byte-identical.
import { useState } from "react";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  parseFrontMatterEntries,
  serializeFrontMatterEntries,
  type FrontMatterEntry,
} from "@/lib/frontMatterEntries";

function closingDelimiterOf(frontMatter: string): string {
  const lines = frontMatter.split("\n");
  const withoutTrailingEmpty = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return withoutTrailingEmpty[withoutTrailingEmpty.length - 1] ?? "---";
}

function innerContentOf(frontMatter: string): string {
  const lines = frontMatter.split("\n");
  const withoutTrailingEmpty = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return withoutTrailingEmpty.slice(1, -1).join("\n");
}

function buildFrontMatter(innerContent: string, closingDelimiter: string): string {
  const innerLines = innerContent === "" ? [] : innerContent.split("\n");
  return ["---", ...innerLines, closingDelimiter, ""].join("\n");
}

/** Inserts a new blank kv row before a trailing blank line, if there is one,
 * so the added row lands after the last real content line instead of after
 * the file's trailing newline. */
function insertBlankRow(entries: FrontMatterEntry[]): FrontMatterEntry[] {
  const blankRow: FrontMatterEntry = { kind: "kv", key: "", sep: ": ", value: "", raw: "" };
  const last = entries[entries.length - 1];
  if (last?.kind === "raw" && last.text === "") {
    return [...entries.slice(0, -1), blankRow, last];
  }
  return [...entries, blankRow];
}

export interface FrontMatterBlockProps {
  /** Raw front matter text (delimiters included), fixed for the lifetime of
   * this component instance — callers key/remount it to start a new edit
   * session (mirrors `MarkdownView`'s `contents`/session convention). */
  frontMatter: string;
  editable: boolean;
  /** Called with the full raw front matter text (delimiters included) on
   * every edit. */
  onChange?: (frontMatter: string) => void;
}

export function FrontMatterBlock({ frontMatter, editable, onChange }: FrontMatterBlockProps) {
  const [entries, setEntries] = useState<FrontMatterEntry[]>(() =>
    parseFrontMatterEntries(innerContentOf(frontMatter)),
  );

  const update = (next: FrontMatterEntry[]) => {
    setEntries(next);
    onChange?.(
      buildFrontMatter(serializeFrontMatterEntries(next), closingDelimiterOf(frontMatter)),
    );
  };

  if (!editable) {
    const visible = entries.filter((e) => !(e.kind === "raw" && e.text.trim() === ""));
    return (
      <div
        data-testid="front-matter-card"
        className="shrink-0 border-b border-border bg-muted/50 p-2 text-xs"
      >
        <div className="mb-1 text-muted-foreground">front matter</div>
        <Table>
          <TableBody>
            {visible.map((entry, i) =>
              entry.kind === "kv" ? (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell className="w-1/3 align-top font-mono text-muted-foreground">
                    {entry.key}
                  </TableCell>
                  <TableCell className="whitespace-pre font-mono">{entry.value}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={2} className="font-mono text-muted-foreground">
                    {entry.text}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border bg-muted/50 p-2 font-mono text-xs">
      <div className="text-muted-foreground">---</div>
      <Table>
        <TableBody>
          {entries.map((entry, i) =>
            entry.kind === "raw" && entry.text.trim() === "" ? null : entry.kind === "kv" ? (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell className="w-1/3 align-top p-1">
                  <input
                    aria-label="front-matter-key"
                    className="w-full bg-transparent outline-none"
                    value={entry.key}
                    onChange={(e) => {
                      const next = entries.slice();
                      next[i] = { ...entry, key: e.target.value };
                      update(next);
                    }}
                  />
                </TableCell>
                <TableCell className="p-1">
                  {entry.value.includes("\n") ? (
                    <textarea
                      aria-label="front-matter-value"
                      className="w-full resize-none bg-transparent outline-none"
                      rows={entry.value.split("\n").length}
                      value={entry.value}
                      onChange={(e) => {
                        const next = entries.slice();
                        next[i] = { ...entry, value: e.target.value };
                        update(next);
                      }}
                    />
                  ) : (
                    <input
                      aria-label="front-matter-value"
                      className="w-full bg-transparent outline-none"
                      value={entry.value}
                      onChange={(e) => {
                        const next = entries.slice();
                        next[i] = { ...entry, value: e.target.value };
                        update(next);
                      }}
                    />
                  )}
                </TableCell>
                <TableCell className="w-4 p-1 align-top">
                  <button
                    type="button"
                    aria-label="front matter の行を削除"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => update(entries.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell colSpan={2} className="p-1">
                  <input
                    aria-label="front-matter-raw"
                    className="w-full bg-transparent text-muted-foreground outline-none"
                    value={entry.text}
                    onChange={(e) => {
                      const next = entries.slice();
                      next[i] = { kind: "raw", text: e.target.value };
                      update(next);
                    }}
                  />
                </TableCell>
                <TableCell className="w-4 p-1 align-top">
                  <button
                    type="button"
                    aria-label="front matter の行を削除"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => update(entries.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      <button
        type="button"
        className="mt-1 text-muted-foreground hover:text-foreground"
        onClick={() => update(insertBlankRow(entries))}
      >
        行を追加
      </button>
      <div className="text-muted-foreground">{closingDelimiterOf(frontMatter)}</div>
    </div>
  );
}

export default FrontMatterBlock;
