import { Bot, GitBranch, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { STATUS_META } from "./PaneRow";

export type RepoWorkspaceRowProps = {
  workspace: WorkspaceGroup;
  pinnedWorktreeRoot: string | null;
  onSelectPane: (paneId: string) => void;
};

/** Statuses summarized on the workspace row, blocked-first (most prominent),
 * per plan.md F8: repository mode is now `repository > workspace` with the
 * workspace as the leaf row (no per-pane rows). */
const SUMMARY_STATUSES = ["blocked", "working", "done"] as const;

/** plan.md F8: one leaf row per workspace inside a repo — label, an
 * aggregated blocked/working/done status summary (icons/colors shared with
 * `PaneRow`, zero counts omitted), an agent count, and a badge per unique
 * non-main branch among the workspace's panes (tooltip lists that branch's
 * worktree root(s)). Clicking focuses the workspace's focused pane, or its
 * first pane. */
export function RepoWorkspaceRow({
  workspace,
  pinnedWorktreeRoot,
  onSelectPane,
}: RepoWorkspaceRowProps) {
  const counts = { blocked: 0, working: 0, done: 0 };
  let agentCount = 0;
  let focusedPane: (typeof workspace.panes)[number] | null = null;
  for (const pane of workspace.panes) {
    if (
      pane.agentStatus === "blocked" ||
      pane.agentStatus === "working" ||
      pane.agentStatus === "done"
    ) {
      counts[pane.agentStatus]++;
    }
    if (pane.agent) agentCount++;
    if (pane.focused) focusedPane = pane;
  }

  const isPinned =
    pinnedWorktreeRoot != null &&
    workspace.panes.some((p) => p.worktreeRoot === pinnedWorktreeRoot);

  const branchBadges = new Map<string, Set<string>>();
  for (const pane of workspace.panes) {
    if (pane.isMain) continue;
    const label = pane.branch ?? pane.worktreeRoot;
    const roots = branchBadges.get(label) ?? new Set<string>();
    roots.add(pane.worktreeRoot);
    branchBadges.set(label, roots);
  }

  function handleClick() {
    const target = focusedPane ?? workspace.panes[0];
    if (target) onSelectPane(target.paneId);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={focusedPane ? "true" : undefined}
      data-testid={`workspace-row-${workspace.workspaceId}`}
      className={cn(
        "flex w-full flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
        focusedPane && "bg-muted font-medium",
        isPinned && "ring-1 ring-inset ring-primary",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{workspace.workspaceLabel}</span>
      {isPinned && <Pin className="size-3 shrink-0 text-primary" aria-label="ピン留め中" />}
      {SUMMARY_STATUSES.map((status) => {
        const count = counts[status];
        if (count === 0) return null;
        const meta = STATUS_META[status];
        const StatusIcon = meta.icon;
        return (
          <span key={status} className={cn("flex shrink-0 items-center gap-0.5", meta.className)}>
            <StatusIcon
              className={cn("size-3", meta.spin && "animate-spin")}
              aria-label={`状態: ${meta.label}`}
            />
            {count}
          </span>
        );
      })}
      {agentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <Bot className="size-3" aria-label="agent 数" />
          {agentCount}
        </span>
      )}
      {[...branchBadges].map(([label, roots]) => (
        <span
          key={label}
          title={[...roots].join(", ")}
          className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground"
        >
          <GitBranch className="size-3" aria-hidden="true" />
          {label}
        </span>
      ))}
    </button>
  );
}
