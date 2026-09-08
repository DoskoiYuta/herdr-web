// VS Code 風のファイルタブバー（ui-redesign.md §5.4 Files）。ツリーでファイル
// をクリックするたびに末尾へ 1 タブ追加する方式（プレビュータブは採らない）。
// ドラッグ並べ替えは無い — タブ列は開いた順のまま。既存の `Tabs`（radix, ui/
// tabs.tsx）はツールタブ専用なので流用せず、素の div + button で組む。

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
  /** 開いた順（追加順）。 */
  paths: string[];
  activePath: string | null;
  /** `path -> worktree に存在するか`。未取得の path は「存在する」扱い —
   * 一括確認クエリが返るまで無いファイル扱いで打ち消し線を出さない。 */
  exists: Record<string, boolean>;
  /** ツリー行と同じ git status 装飾（gitStatusDecoration.ts）。 */
  decorations?: Map<string, FileTabDecoration>;
  onSelect(path: string): void;
  onClose(path: string): void;
  onCloseOthers(path: string): void;
  onCloseAll(): void;
  onCopyPath(path: string): void;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function FileTabBar({
  paths,
  activePath,
  exists,
  decorations,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
}: FileTabBarProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // アクティブなタブが画面外（タブ列の横スクロール）にあっても見える位置へ
    // スクロールする — ツリークリックで末尾に足したタブや、他ウィンドウから
    // 復元された選択がスクロール外だと気付けない。
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePath]);

  if (paths.length === 0) return null;

  const basenameCounts = new Map<string, number>();
  for (const path of paths) {
    const b = basename(path);
    basenameCounts.set(b, (basenameCounts.get(b) ?? 0) + 1);
  }

  return (
    <div
      role="tablist"
      className="flex shrink-0 overflow-x-auto border-b border-border [scrollbar-width:thin]"
    >
      {paths.map((path) => {
        const isActive = path === activePath;
        const isMissing = exists[path] === false;
        const label = basename(path);
        const dec = decorations?.get(path);
        return (
          <ContextMenu key={path}>
            <ContextMenuTrigger asChild>
              <button
                ref={isActive ? activeTabRef : undefined}
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
                )}
              >
                <span className={cn("truncate", isMissing && "text-destructive line-through")}>
                  {label}
                </span>
                {(basenameCounts.get(label) ?? 0) > 1 && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {parentDir(path)}
                  </span>
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
      })}
    </div>
  );
}

export default FileTabBar;
