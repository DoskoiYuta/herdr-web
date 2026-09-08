import type { Block } from "@contract/decision";
import { MarkdownView } from "@/components/files/MarkdownView";
import { CodeBlock } from "./blocks/CodeBlock";
import { DiffBlock } from "./blocks/DiffBlock";
import { HtmlBlock } from "./blocks/HtmlBlock";
import { ImageBlock } from "./blocks/ImageBlock";
import { LocationBlock } from "./blocks/LocationBlock";
import { MermaidBlock } from "./blocks/MermaidBlock";
import { SvgBlock } from "./blocks/SvgBlock";
import { TableBlock } from "./blocks/TableBlock";

export type OpenLocation = (location: {
  worktreeRoot: string;
  path: string;
  lines: [number, number] | null;
}) => void;

export interface BlockViewProps {
  block: Block;
  /** `image`/`location` Blocks resolve their path against the request's
   * caller worktree — null when that worktree is unknown. Used for both
   * `context` and option `preview` Blocks, which share this component. */
  worktreeRoot?: string | null;
  onOpenLocation?: OpenLocation;
}

/** Renders one Block by `kind`. Shared by `context` and option `preview` —
 * both are plain `Block[]` arrays. */
export function BlockView({ block, worktreeRoot = null, onOpenLocation }: BlockViewProps) {
  switch (block.kind) {
    case "markdown":
      return <MarkdownView contents={block.text} compact />;
    case "code":
      return <CodeBlock language={block.language} text={block.text} />;
    case "diff":
      return <DiffBlock patch={block.patch} />;
    case "mermaid":
      return <MermaidBlock text={block.text} />;
    case "svg":
      return <SvgBlock markup={block.markup} />;
    case "html":
      return <HtmlBlock html={block.html} allowScripts={block.allowScripts} />;
    case "image":
      return <ImageBlock path={block.path} worktreeRoot={worktreeRoot} />;
    case "location":
      return (
        <LocationBlock
          path={block.path}
          lines={block.lines}
          worktreeRoot={worktreeRoot}
          onOpen={onOpenLocation}
        />
      );
    case "table":
      return <TableBlock header={block.header} rows={block.rows} />;
  }
}
