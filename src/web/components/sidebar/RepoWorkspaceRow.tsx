import { Bot, GitBranch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { herdrApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { STATUS_META } from "@/components/ui/status/AgentStatusDot";

export type RepoWorkspaceRowProps = {
  workspace: WorkspaceGroup;
  /** herdr で現在フォーカスされている workspace。背景ハイライトはこれだけを表す。 */
  focusedWorkspaceId: string | null;
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
 * first pane.
 *
 * Right-click opens a context menu with 名前を変更 (a dialog with the label
 * prefilled, calling `renameWorkspace`) and 削除 (a destructive confirm
 * dialog naming the workspace and warning that its panes/agents will be
 * terminated, calling `closeWorkspace(id, { confirm: true })`). */
export function RepoWorkspaceRow({
  workspace,
  focusedWorkspaceId,
  onSelectPane,
}: RepoWorkspaceRowProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameLabel, setRenameLabel] = useState(workspace.workspaceLabel);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // pane.focused は workspace ごとの「その workspace 内でアクティブな pane」なので、
  // 選択状態の判定には使わない（全 workspace がハイライトされてしまう）。
  const isFocusedWorkspace = workspace.workspaceId === focusedWorkspaceId;

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

  function openRename() {
    setRenameLabel(workspace.workspaceLabel);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const label = renameLabel.trim();
    if (!label) {
      setRenameError("名前を入力してください");
      return;
    }
    setRenameSubmitting(true);
    setRenameError(null);
    try {
      await herdrApi.renameWorkspace(workspace.workspaceId, label);
      setRenameOpen(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "名前の変更に失敗しました");
    } finally {
      setRenameSubmitting(false);
    }
  }

  function openDelete() {
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function handleDeleteConfirm() {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await herdrApi.closeWorkspace(workspace.workspaceId, { confirm: true });
      setDeleteOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            aria-current={isFocusedWorkspace ? "true" : undefined}
            data-testid={`workspace-row-${workspace.workspaceId}`}
            className={cn(
              "flex w-full flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
              isFocusedWorkspace && "bg-muted font-medium",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{workspace.workspaceLabel}</span>
            {SUMMARY_STATUSES.map((status) => {
              const count = counts[status];
              if (count === 0) return null;
              const meta = STATUS_META[status];
              const StatusIcon = meta.icon;
              return (
                <span
                  key={status}
                  className={cn("flex shrink-0 items-center gap-0.5", meta.className)}
                >
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={openRename}>名前を変更</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={openDelete}>
            削除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ワークスペース名を変更</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="flex flex-col gap-2">
            <Input
              autoFocus
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              aria-label="ワークスペース名"
              disabled={renameSubmitting}
            />
            {renameError && <p className="text-xs text-destructive">{renameError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={renameSubmitting}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{workspace.workspaceLabel}」を削除しますか？</DialogTitle>
            <DialogDescription>
              このワークスペースの pane と、そこで動いている agent
              はすべて終了します。この操作は元に戻せません。
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteSubmitting}
            >
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
