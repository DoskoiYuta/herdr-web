// Markdown viewer/editor via @wysimark/react (chosen — see plan.md F9). With
// no `onChange` prop this stays read-only: wysimark 3 has no `readOnly` prop,
// so read-only-ness is forced by hand — after mount, and again whenever
// `contents` changes, this sets contenteditable="false" on the rendered
// Slate root. React never fights this back to "true" because Slate owns
// that DOM node imperatively (via slate-react's own effects) rather than
// through a prop React re-renders from — see
// node_modules/@wysimark/react/.dist/browser/index.esm.js's `Editable2`.
// Passing `onChange` (Notes tab) skips that override and lets Slate keep
// contenteditable, and switches the toolbar-hiding CSS class (index.css) so
// the toolbar shows.

import { Editable, useEditor } from "@wysimark/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MarkdownViewProps {
  contents: string;
  /** Shrinks headings/body to text-sm scale — used where markdown is one
   * Block among many small UI elements (decision context/preview) rather
   * than a document-sized preview (Files tab). */
  compact?: boolean;
  /** Presence (not value) selects edit vs. read-only mode. Called with the
   * document's markdown serialization on each Slate change. */
  onChange?: (markdown: string) => void;
  /** Scroll position to restore on mount (fileScroll.ts). Callers that need
   * per-file restoration must remount this component on file change (e.g.
   * `key={path}`) — there is no other "new file" signal to key a restoring
   * effect off. */
  scrollTop?: number;
  onScrollTopChange?: (top: number) => void;
}

/** Nearest scrolling ancestor of Slate's root inside `container` (falls back
 * to `container` itself, e.g. before wysimark has mounted). */
function findScroller(container: HTMLElement): HTMLElement {
  let el = container.querySelector<HTMLElement>("[data-slate-editor]");
  while (el && el !== container) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return container;
}

function noop() {
  // read-only: edits are discarded rather than fed back into `contents`
}

export function MarkdownView({
  contents,
  compact = false,
  onChange,
  scrollTop,
  onScrollTopChange,
}: MarkdownViewProps) {
  const editor = useEditor({ height: compact ? "auto" : "100%" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editable = onChange !== undefined;

  // The element that actually scrolls is wysimark's own editable wrapper (an
  // emotion-styled div with a generated class name, `overflow-y: auto`,
  // height 100%), not this container — so the scroller is located by walking
  // up from Slate's root instead of by class name.
  const scrollerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    scrollerRef.current = findScroller(container);
    if (scrollTop !== undefined) scrollerRef.current.scrollTop = scrollTop;
    // mount-only: restoration relies on the caller remounting via `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editable) return;
    const node = containerRef.current?.querySelector<HTMLElement>("[data-slate-editor]");
    node?.setAttribute("contenteditable", "false");
    // `contents` isn't read in the body — it's a proxy for "Slate just
    // re-parsed and re-rendered its DOM node", which can drop the attribute
    // set above (see the file-level comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents, editable]);

  return (
    <div
      ref={containerRef}
      className={cn(
        editable ? "md-editable" : "md-readonly",
        "overflow-auto",
        compact ? "h-auto" : "h-full min-h-0",
        compact && "md-readonly-compact",
      )}
      onScrollCapture={
        onScrollTopChange
          ? (e) => {
              if (e.target === scrollerRef.current)
                onScrollTopChange(scrollerRef.current.scrollTop);
            }
          : undefined
      }
    >
      <Editable editor={editor} value={contents} onChange={onChange ?? noop} />
    </div>
  );
}

export default MarkdownView;
