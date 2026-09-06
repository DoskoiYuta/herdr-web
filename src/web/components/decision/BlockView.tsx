import type { Block } from "@contract/decision";
import { MarkdownView } from "@/components/files/MarkdownView";

/** `markdown` だけ実描画し、他の Block kind は種別名を出すプレースホルダにとどめる。 */
export function BlockView({ block }: { block: Block }) {
  if (block.kind === "markdown") {
    return <MarkdownView contents={block.text} />;
  }
  return (
    <div className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
      （{block.kind} は未対応）
    </div>
  );
}
