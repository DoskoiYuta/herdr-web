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
 * both are plain `Block[]` arrays. Wrapped in a `shrink-0` div: both callers
 * lay Blocks out in a `flex-col`, where a plain block-level child is also a
 * flex item and gets compressed below its content size (`flex-shrink: 1`
 * default) whenever the column itself is height-constrained — table/mermaid
 * would render clipped instead of at full size. */
export function BlockView({ block, worktreeRoot = null, onOpenLocation }: BlockViewProps) {
  return <div className="shrink-0">{renderBlock(block, worktreeRoot, onOpenLocation)}</div>;
}

function renderBlock(
  block: Block,
  worktreeRoot: string | null,
  onOpenLocation: OpenLocation | undefined,
) {
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
      // Keyed by `path`: a context/preview swap keeps this element's
      // position in the tree, so without a per-path key React would reuse
      // the previous ImageBlock instance and its error/dims/zoomed state.
      return <ImageBlock key={block.path} path={block.path} worktreeRoot={worktreeRoot} />;
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
