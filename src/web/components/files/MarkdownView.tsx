// Read-only markdown preview via @wysimark/react (chosen — see plan.md F9 —
// because editing is a planned follow-up and this same editor will grow a
// save path later). wysimark 3 has no `readOnly` prop, so read-only-ness is
// forced by hand: after mount, and again whenever `contents` changes, this
// sets contenteditable="false" on the rendered Slate root. React never
// fights this back to "true" because Slate owns that DOM node imperatively
// (via slate-react's own effects) rather than through a prop React re-renders
// from — see node_modules/@wysimark/react/.dist/browser/index.esm.js's
// `Editable2`. The toolbar is hidden in src/web/index.css instead of here:
// it renders as `$OuterContainer`'s first child (see `renderEditable` in the
// same bundle), which this component's DOM has no direct handle on.

import { Editable, useEditor } from "@wysimark/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MarkdownViewProps {
  contents: string;
  /** Shrinks headings/body to text-sm scale — used where markdown is one
   * Block among many small UI elements (decision context/preview) rather
   * than a document-sized preview (Files tab). */
  compact?: boolean;
}

function noop() {
  // read-only: edits are discarded rather than fed back into `contents`
}

export function MarkdownView({ contents, compact = false }: MarkdownViewProps) {
  const editor = useEditor({ height: compact ? "auto" : "100%" });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current?.querySelector<HTMLElement>("[data-slate-editor]");
    node?.setAttribute("contenteditable", "false");
    // `contents` isn't read in the body — it's a proxy for "Slate just
    // re-parsed and re-rendered its DOM node", which can drop the attribute
    // set above (see the file-level comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "md-readonly overflow-auto",
        compact ? "h-auto" : "h-full min-h-0",
        compact && "md-readonly-compact",
      )}
    >
      <Editable editor={editor} value={contents} onChange={noop} />
    </div>
  );
}

export default MarkdownView;
