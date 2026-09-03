import { ChevronRight, CircleCheck, OctagonAlert } from "lucide-react";
import type { Repo } from "@contract/events";
import { Badge } from "@/components/ui/badge";
import { groupByWorkspace } from "@/lib/repoWorkspaces";
import { cn } from "@/lib/utils";
import { RepoWorkspaceRow } from "./RepoWorkspaceRow";

export type RepoGroupProps = {
  repo: Repo;
  /** basename が他リポジトリと衝突する場合、見出しに親ディレクトリも添える。 */
  displayName: string;
  pinnedWorktreeRoot: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectPane: (paneId: string) => void;
};

/** plan.md F8-1 / F8-4: repository ヘッダーに名前と blocked/done バッジ（blocked を
 * 最優先、色だけに頼らずアイコンも出す）を出し、折りたたみ可能にする。中身は
 * `repository > worktree > pane` ではなく `repository > workspace`（leaf 行）。 */
export function RepoGroup({
  repo,
  displayName,
  pinnedWorktreeRoot,
  collapsed,
  onToggleCollapse,
  onSelectPane,
}: RepoGroupProps) {
  const workspaces = groupByWorkspace(repo);

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
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
          {workspaces.map((workspace) => (
            <RepoWorkspaceRow
              key={workspace.workspaceId}
              workspace={workspace}
              pinnedWorktreeRoot={pinnedWorktreeRoot}
              onSelectPane={onSelectPane}
            />
          ))}
        </div>
      )}
    </div>
  );
}
