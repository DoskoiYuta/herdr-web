// `code` Block: read-only, unhighlighted. context/preview Blocks sit inline
// among small UI copy (design.pen P3v2) — a plain `<pre>` matches that flow;
// @pierre/diffs's `File` (used for the Files tab's CodeFileView) brings its
// own filename tab and fixed dark chrome, which reads as a boxed-off card
// here instead of body text.
import { isTooLarge, TooLargeBlock } from "./TooLargeBlock";

export function CodeBlock({ text }: { language: string; text: string }) {
  if (isTooLarge(text)) return <TooLargeBlock text={text} />;
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed">
      <code>{text}</code>
    </pre>
  );
}
