import { ChevronRight, GitBranch, Pin } from "lucide-react";
import type { WorktreeRow } from "@contract/events";
import { cn } from "@/lib/utils";
import { PaneRow } from "./PaneRow";

export type WorktreeGroupProps = {
  worktree: WorktreeRow;
  pinned: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectPane: (paneId: string) => void;
};

/** plan.md §6.6 / F8-1: worktree 行はブランチ名と main/linked マーカーを出し、
 * ピン留め中の worktree にはピンアイコンを付ける。 */
export function WorktreeGroup({
  worktree,
  pinned,
  collapsed,
  onToggleCollapse,
  onSelectPane,
}: WorktreeGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")}
        />
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{worktree.branch ?? worktree.root}</span>
        <span className="shrink-0 text-[10px]">{worktree.isMain ? "main worktree" : "linked"}</span>
        {pinned && <Pin className="size-3 shrink-0 text-primary" aria-label="ピン留め中" />}
      </button>
      {!collapsed && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
          {worktree.panes.map((pane) => (
            <PaneRow key={pane.paneId} pane={pane} onSelect={onSelectPane} />
          ))}
        </div>
      )}
    </div>
  );
}
