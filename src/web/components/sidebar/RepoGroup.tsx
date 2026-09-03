import { ChevronRight, CircleCheck, OctagonAlert } from "lucide-react";
import type { Repo } from "@contract/events";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WorktreeGroup } from "./WorktreeGroup";

export type RepoGroupProps = {
  repo: Repo;
  /** basename が他リポジトリと衝突する場合、見出しに親ディレクトリも添える。 */
  displayName: string;
  pinnedWorktreeRoot: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  collapsedWorktrees: ReadonlySet<string>;
  onToggleWorktreeCollapse: (root: string) => void;
  onSelectPane: (paneId: string) => void;
};

/** plan.md F8-1 / F8-4: repository ヘッダーに名前と blocked/done バッジ（blocked を
 * 最優先、色だけに頼らずアイコンも出す）を出し、折りたたみ可能にする。 */
export function RepoGroup({
  repo,
  displayName,
  pinnedWorktreeRoot,
  collapsed,
  onToggleCollapse,
  collapsedWorktrees,
  onToggleWorktreeCollapse,
  onSelectPane,
}: RepoGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        data-testid={`repo-header-${repo.key}`}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-muted"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
        {repo.counts.blocked > 0 && (
          <Badge variant="destructive" className="gap-0.5">
            <OctagonAlert className="size-3" aria-hidden="true" />
            {repo.counts.blocked}
          </Badge>
        )}
        {repo.counts.done > 0 && (
          <Badge variant="secondary" className="gap-0.5 text-green-600 dark:text-green-400">
            <CircleCheck className="size-3" aria-hidden="true" />
            {repo.counts.done}
          </Badge>
        )}
      </button>
      {!collapsed && (
        <div className="ml-3 flex flex-col gap-1 border-l border-border pl-2">
          {repo.worktrees.map((worktree) => (
            <WorktreeGroup
              key={worktree.root}
              worktree={worktree}
              pinned={worktree.root === pinnedWorktreeRoot}
              collapsed={collapsedWorktrees.has(worktree.root)}
              onToggleCollapse={() => onToggleWorktreeCollapse(worktree.root)}
              onSelectPane={onSelectPane}
            />
          ))}
        </div>
      )}
    </div>
  );
}
