import { ChevronRight, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientWorkspaceNode } from "@/lib/workspaceView";
import { PaneRow } from "./PaneRow";

export type WorkspaceGroupProps = {
  workspace: ClientWorkspaceNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectPane: (paneId: string) => void;
};

/** plan.md §6.6 表示モード "workspace": `workspace > tab > pane` を表示する。 */
export function WorkspaceGroup({
  workspace,
  collapsed,
  onToggleCollapse,
  onSelectPane,
}: WorkspaceGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-muted"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")}
        />
        <LayoutGrid className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">workspace {workspace.workspaceId}</span>
      </button>
      {!collapsed && (
        <div className="ml-3 flex flex-col gap-1.5 border-l border-border pl-2">
          {workspace.tabs.map((tab) => (
            <div key={tab.tabId}>
              <div className="truncate px-1.5 py-0.5 text-[10px] text-muted-foreground">
                tab {tab.tabId}
              </div>
              <div className="ml-2 flex flex-col gap-0.5">
                {tab.panes.map((pane) => (
                  <PaneRow key={pane.paneId} pane={pane} onSelect={onSelectPane} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
