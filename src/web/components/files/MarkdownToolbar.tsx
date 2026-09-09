import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface MarkdownToolbarProps {
  editor: Editor;
}

export function MarkdownToolbar({ editor }: MarkdownToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      heading1: e.isActive("heading", { level: 1 }),
      heading2: e.isActive("heading", { level: 2 }),
      heading3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      inTable: e.isActive("table"),
      link: e.isActive("link"),
      linkHref: e.getAttributes("link").href as string | undefined,
      hasSelection: !e.state.selection.empty,
    }),
  });

  return (
    <TooltipProvider>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
        <ToolbarButton
          label="見出し1"
          active={state.heading1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 />
        </ToolbarButton>
        <ToolbarButton
          label="見出し2"
          active={state.heading2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="見出し3"
          active={state.heading3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 />
        </ToolbarButton>

        <ToolbarSeparator />

        <ToolbarButton
          label="太字"
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="斜体"
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="取り消し線"
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          label="インラインコード"
          active={state.code}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code />
        </ToolbarButton>

        <ToolbarSeparator />

        <ToolbarButton
          label="箇条書き"
          active={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="番号リスト"
          active={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="タスクリスト"
          active={state.taskList}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks />
        </ToolbarButton>

        <ToolbarSeparator />

        <ToolbarButton
          label="引用"
          active={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarButton
          label="コードブロック"
          active={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <SquareCode />
        </ToolbarButton>
        <ToolbarButton
          label="水平線"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
        </ToolbarButton>

        <ToolbarSeparator />

        {state.inTable ? (
          <TableMenu editor={editor} />
        ) : (
          <ToolbarButton
            label="表を挿入"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <TableIcon />
          </ToolbarButton>
        )}

        <ToolbarSeparator />

        <LinkButton
          editor={editor}
          active={state.link}
          href={state.linkHref}
          disabled={!state.hasSelection}
        />
      </div>
    </TooltipProvider>
  );
}

function ToolbarSeparator() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          className={cn(active && "bg-muted text-foreground")}
          // A default mousedown moves focus to the button and collapses the
          // ProseMirror selection before onClick runs, so toggle commands
          // that need the selection (bold, table insert, etc.) would act on
          // an empty one.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TableMenu({ editor }: { editor: Editor }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="表の操作"
              onMouseDown={(e) => e.preventDefault()}
            >
              <TableIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>表の操作</TooltipContent>
      </Tooltip>
      {/* No header-row toggle: GFM tables always have a header row, and a
          table without one serializes without the delimiter row, so it stops
          being a table on the next load. */}
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()}>
          上に行を追加
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
          下に行を追加
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()}>
          左に列を追加
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
          右に列を追加
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
          行を削除
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
          列を削除
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          表を削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinkButton({
  editor,
  active,
  href,
  disabled,
}: {
  editor: Editor;
  active: boolean;
  href: string | undefined;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUrl(href ?? "");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="リンク"
              aria-pressed={active}
              disabled={disabled && !active}
              className={cn(active && "bg-muted text-foreground")}
              onMouseDown={(e) => e.preventDefault()}
            >
              <LinkIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>リンク</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-64"
        // Radix focuses the content on open by default, which would steal
        // focus before the `autoFocus` input below claims it.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url) return;
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            setOpen(false);
          }}
        >
          <input
            autoFocus
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button type="submit" size="sm" disabled={!url}>
            設定
          </Button>
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setOpen(false);
              }}
            >
              解除
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

export default MarkdownToolbar;
