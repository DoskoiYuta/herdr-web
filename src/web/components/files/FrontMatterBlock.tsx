// Displays/edits YAML front matter outside the Tiptap document (see
// @/lib/frontMatter.ts for why it can't live inside Tiptap). Delimiter
// lines are shown but not editable — only the content between them is.
import { useState } from "react";

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
  const [inner, setInner] = useState(() => innerContentOf(frontMatter));

  if (!editable) {
    return (
      <div
        data-testid="front-matter-card"
        className="shrink-0 border-b border-border bg-muted/50 p-2 font-mono text-xs"
      >
        <div className="mb-1 text-muted-foreground">front matter</div>
        <pre className="whitespace-pre-wrap">{innerContentOf(frontMatter)}</pre>
      </div>
    );
  }

  const closingDelimiter = closingDelimiterOf(frontMatter);
  return (
    <div className="shrink-0 border-b border-border bg-muted/50 p-2 font-mono text-xs">
      <div className="text-muted-foreground">---</div>
      <textarea
        aria-label="front-matter-editor"
        className="w-full resize-none bg-transparent outline-none"
        rows={Math.max(1, inner.split("\n").length)}
        value={inner}
        onChange={(e) => {
          setInner(e.target.value);
          onChange?.(buildFrontMatter(e.target.value, closingDelimiter));
        }}
      />
      <div className="text-muted-foreground">{closingDelimiter}</div>
    </div>
  );
}

export default FrontMatterBlock;
