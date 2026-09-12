// VS Code 風のファイルタブバー（ui-redesign.md §5.4 Files）。ツリーでファイル
// をクリックするたびに末尾へ 1 タブ追加する方式（プレビュータブは採らない）。
// ドラッグで並べ替えられる（@dnd-kit）— 既存の `Tabs`（radix, ui/tabs.tsx）は
// ツールタブ専用なので流用せず、素の div + button で組む。

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export interface FileTabDecoration {
  text: string;
  parts?: { text: string; color?: string }[];
}

export interface FileTabBarProps {
  /** 開いた順（並べ替え可）。 */
  paths: string[];
  activePath: string | null;
  /** `path -> worktree に存在するか`。未取得の path は「存在する」扱い —
   * 一括確認クエリが返るまで無いファイル扱いで打ち消し線を出さない。 */
  exists: Record<string, boolean>;
  /** ツリー行と同じ git status 装飾（gitStatusDecoration.ts）。 */
  decorations?: Map<string, FileTabDecoration>;
  /** `path -> 保存していない編集があるか`（下書き ≠ ディスク内容）。未指定の
   * path は dirty ではない扱い。 */
  dirty?: Record<string, boolean>;
  onSelect(path: string): void;
  onClose(path: string): void;
  onCloseOthers(path: string): void;
  onCloseAll(): void;
  onCopyPath(path: string): void;
  /** ドラッグでタブを並べ替えたときの新しい位置（`fileTabs.ts` の `reorderTabs`
   * と同じ意味の from/to）。 */
  onReorder(from: number, to: number): void;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

// A fresh object here would defeat `useSensor`'s own `useMemo` (it depends on
// this options object's identity), re-registering PointerSensor's document
// listeners on every render.
const POINTER_ACTIVATION_CONSTRAINT = { activationConstraint: { distance: 4 } };

interface TabProps {
  path: string;
  isActive: boolean;
  isMissing: boolean;
  isDirty: boolean;
  label: string;
  parentHint: string | null;
  dec?: FileTabDecoration;
  activeTabRef: React.RefObject<HTMLButtonElement | null>;
  onSelect(path: string): void;
  onClose(path: string): void;
  onCloseOthers(path: string): void;
  onCloseAll(): void;
  onCopyPath(path: string): void;
}

function FileTab({
  path,
  isActive,
  isMissing,
  isDirty,
  label,
  parentHint,
  dec,
  activeTabRef,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
}: TabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={(el) => {
            setNodeRef(el);
            if (isActive) activeTabRef.current = el;
          }}
          style={style}
          {...attributes}
          {...listeners}
          type="button"
          role="tab"
          aria-selected={isActive}
          data-missing={isMissing ? "true" : undefined}
          title={isMissing ? "この worktree には存在しません" : undefined}
          onClick={() => onSelect(path)}
          onMouseDown={(e) => {
            // 中クリックで閉じる。
            if (e.button === 1) {
              e.preventDefault();
              onClose(path);
            }
          }}
          className={cn(
            "group flex shrink-0 items-center gap-1.5 border-r border-border px-2.5 py-1 text-xs",
            isActive
              ? "border-b-2 border-b-sky-500 bg-background text-foreground"
              : "text-muted-foreground hover:bg-muted/50",
            isDragging && "z-10 shadow-md",
          )}
        >
          <span className={cn("truncate", isMissing && "text-destructive line-through")}>
            {label}
          </span>
          {isDirty && (
            <span
              aria-label="保存していない変更があります"
              title="保存していない変更があります"
              className="size-1.5 shrink-0 rounded-full bg-foreground"
            />
          )}
          {parentHint !== null && (
            <span className="truncate text-[10px] text-muted-foreground">{parentHint}</span>
          )}
          {dec && (
            <span className="text-[10px]" style={{ color: dec.parts?.[0]?.color }}>
              {dec.text}
            </span>
          )}
          <span
            role="button"
            aria-label={`${path} を閉じる`}
            className="ml-0.5 shrink-0 rounded-sm opacity-0 hover:bg-muted group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onClose(path);
            }}
          >
            <X className="size-3" aria-hidden />
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onClose(path)}>閉じる</ContextMenuItem>
        <ContextMenuItem onSelect={() => onCloseOthers(path)}>他を閉じる</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>すべて閉じる</ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyPath(path)}>パスをコピー</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FileTabBar({
  paths,
  activePath,
  exists,
  decorations,
  dirty,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
  onReorder,
}: FileTabBarProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // アクティブなタブが画面外（タブ列の横スクロール）にあっても見える位置へ
    // スクロールする — ツリークリックで末尾に足したタブや、他ウィンドウから
    // 復元された選択がスクロール外だと気付けない。
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePath]);

  // distance:4 でクリック・中クリック・✕・右クリックメニューの操作とドラッグ
  // 開始を区別する（4px 未満の動きはドラッグと見なさない）。
  const sensors = useSensors(useSensor(PointerSensor, POINTER_ACTIVATION_CONSTRAINT));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = paths.indexOf(String(active.id));
    const to = paths.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  if (paths.length === 0) return null;

  const basenameCounts = new Map<string, number>();
  for (const path of paths) {
    const b = basename(path);
    basenameCounts.set(b, (basenameCounts.get(b) ?? 0) + 1);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div role="tablist" className="flex overflow-x-auto [scrollbar-width:thin]">
        <SortableContext items={paths} strategy={horizontalListSortingStrategy}>
          {paths.map((path) => {
            const isActive = path === activePath;
            const isMissing = exists[path] === false;
            const label = basename(path);
            const hasParentHint = (basenameCounts.get(label) ?? 0) > 1;
            return (
              <FileTab
                key={path}
                path={path}
                isActive={isActive}
                isMissing={isMissing}
                isDirty={dirty?.[path] === true}
                label={label}
                parentHint={hasParentHint ? parentDir(path) : null}
                dec={decorations?.get(path)}
                activeTabRef={activeTabRef}
                onSelect={onSelect}
                onClose={onClose}
                onCloseOthers={onCloseOthers}
                onCloseAll={onCloseAll}
                onCopyPath={onCopyPath}
              />
            );
          })}
        </SortableContext>
      </div>
    </DndContext>
  );
}

export default FileTabBar;
