import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { MarkdownToolbar } from "./MarkdownToolbar";

export interface MarkdownViewProps {
  contents: string;
  /** Shrinks headings/body to text-sm scale — used where markdown is one
   * Block among many small UI elements (decision context/preview) rather
   * than a document-sized preview (Files tab). */
  compact?: boolean;
  /** Presence (not value) selects edit vs. read-only mode. Called with the
   * document's markdown serialization on each edit. */
  onChange?: (markdown: string) => void;
  /** Called once, shortly after `contents` is parsed, with the editor's own
   * serialization of it — before any user edit. Deferred a tick past mount
   * (see the `onCreate` handler) so it captures ProseMirror's own schema
   * fix-ups (e.g. the empty paragraph some editor-only pass appends after a
   * trailing table — never present in a plain round-trip, only once the
   * document is mounted in a live view) rather than racing them. Callers
   * that need to merge WYSIWYG edits back into the un-normalized source
   * (markdownMerge.ts) use this as the merge's `normalized` baseline. */
  onNormalized?: (markdown: string) => void;
  /** Scroll position to restore on mount (fileScroll.ts). Callers that need
   * per-file restoration must remount this component on file change (e.g.
   * `key={path}`) — there is no other "new file" signal to key a restoring
   * effect off. */
  scrollTop?: number;
  onScrollTopChange?: (top: number) => void;
}

export function MarkdownView({
  contents,
  compact = false,
  onChange,
  onNormalized,
  scrollTop,
  onScrollTopChange,
}: MarkdownViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editable = onChange !== undefined;

  // Markdown last exchanged with the caller, in either direction. The editor's
  // own serialization of `contents` differs from `contents` itself (table
  // padding, blank lines), so comparing against `getMarkdown()` would re-set
  // the document on every mount and echo a normalized copy back through
  // `onChange`.
  const lastMarkdownRef = useRef(contents);
  // True until the deferred `onNormalized` capture below runs. Any `onUpdate`
  // before that point is ProseMirror's own schema fix-up settling — not a
  // user edit — and must not reach `onChange` (it would mark the file dirty
  // with no edit to show for it).
  const normalizedPendingRef = useRef(onNormalized !== undefined);
  const normalizedValueRef = useRef<string | null>(null);

  const editor = useEditor({
    editable,
    extensions: [StarterKit, TableKit, TaskList, TaskItem.configure({ nested: false }), Markdown],
    content: contents,
    contentType: "markdown",
    onCreate: onNormalized
      ? ({ editor: e }) => {
          setTimeout(() => {
            if (e.isDestroyed) return;
            const markdown = e.getMarkdown();
            normalizedValueRef.current = markdown;
            normalizedPendingRef.current = false;
            onNormalized(markdown);
          }, 0);
        }
      : undefined,
    onUpdate: onChange
      ? ({ editor: e }) => {
          if (normalizedPendingRef.current) return;
          const markdown = e.getMarkdown();
          // A fix-up transaction that resolves to exactly the captured
          // baseline (no visible change) isn't a user edit either.
          if (markdown === normalizedValueRef.current) return;
          lastMarkdownRef.current = markdown;
          onChange(markdown);
        }
      : undefined,
  });

  // Round-trips through markdown drop table-cell line breaks (marked has no
  // block-level cell content) — not exercised by this app's editor UI.
  useEffect(() => {
    if (!editor || contents === lastMarkdownRef.current) return;
    lastMarkdownRef.current = contents;
    editor.commands.setContent(contents, { contentType: "markdown", emitUpdate: false });
    if (onNormalized) {
      normalizedPendingRef.current = true;
      setTimeout(() => {
        if (editor.isDestroyed) return;
        const markdown = editor.getMarkdown();
        normalizedValueRef.current = markdown;
        normalizedPendingRef.current = false;
        onNormalized(markdown);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, contents]);

  useEffect(() => {
    const el = containerRef.current;
    if (el && scrollTop !== undefined) el.scrollTop = scrollTop;
    // mount-only: restoration relies on the caller remounting via `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("flex flex-col", compact ? "h-auto" : "h-full min-h-0")}>
      {editable && editor && <MarkdownToolbar editor={editor} />}
      <div
        ref={containerRef}
        className={cn(
          "prose prose-sm max-w-none dark:prose-invert",
          "overflow-auto",
          compact ? "h-auto md-readonly-compact" : "h-full min-h-0",
        )}
        onScroll={
          onScrollTopChange ? (e) => onScrollTopChange(e.currentTarget.scrollTop) : undefined
        }
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default MarkdownView;
