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
  /** Called once, right after `contents` is parsed, with the editor's own
   * serialization of it — before any user edit. Callers that need to merge
   * WYSIWYG edits back into the un-normalized source (markdownMerge.ts) use
   * this as the merge's `normalized` baseline. */
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

  const editor = useEditor({
    editable,
    extensions: [StarterKit, TableKit, TaskList, TaskItem.configure({ nested: false }), Markdown],
    content: contents,
    contentType: "markdown",
    onCreate: onNormalized ? ({ editor: e }) => onNormalized(e.getMarkdown()) : undefined,
    onUpdate: onChange
      ? ({ editor: e }) => {
          const markdown = e.getMarkdown();
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
    onNormalized?.(editor.getMarkdown());
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
