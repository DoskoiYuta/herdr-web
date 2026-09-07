import { Bot, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { PaneRow } from "./PaneRow";

export type RepoWorkspaceRowProps = {
  workspace: WorkspaceGroup;
  /** herdr で現在フォーカスされている workspace。背景ハイライトはこれだけを表す。 */
  focusedWorkspaceId: string | null;
  /** herdr で現在フォーカスされている pane（`state.focus.pane`）。展開時の pane
   * 行のアクセント表示に使う。 */
  focusedPaneId: string | null;
  /** フォーカス中 pane の `agentSession.value`。他 pane には出しようがない
   * ("session id をコピー" は無理に API を足さず、フォーカス中の pane だけ有効)。 */
  focusedAgentSessionId: string | null;
  onSelectPane: (paneId: string) => void;
  /** 右クリック「Diff を開く」: フォーカスを移してから `/focus/diff` へ遷移する。 */
  onOpenDiff: (paneId: string) => void;
};

/** ui-redesign.md §5.2 の集計に出す状態、blocked を最優先。 */
const SUMMARY_STATUSES = ["blocked", "working", "done"] as const;

/** ui-redesign.md §4.2 D4/D5, §5.2: `Repository > Workspace > Pane` の
 * Workspace 行。展開すると配下の pane 行が出る（既定はフォーカス中 workspace
 * だけ展開、以降はこのコンポーネントの state）。フォーカス中 workspace は
 * 背景 + 行末の focus ドットで強調する（D5）。
 *
 * 右クリックメニュー: フォーカスを移す / 名前を変更 / Diff を開く / 削除。
 * 「Diff を開く」はフォーカス pane（無ければ先頭 pane）へまずフォーカスを
 * 移し、`onOpenDiff` が `/focus/diff` への遷移（sub/from/to を落とす）を担う。 */
export function RepoWorkspaceRow({
  workspace,
  focusedWorkspaceId,
  focusedPaneId,
  focusedAgentSessionId,
  onSelectPane,
  onOpenDiff,
}: RepoWorkspaceRowProps) {
  const isFocusedWorkspace = workspace.workspaceId === focusedWorkspaceId;
  // null は「ユーザーが未操作」— その間は展開状態がフォーカスに追従する。
  // 手で開閉すると true/false に固定され、以後フォーカスが動いても変わらない
  // — ただし、この workspace に *新たに* フォーカスが移った瞬間だけは、
  // ユーザー操作を忘れて自動展開に戻す（レンダー中の派生 state 更新。
  // `wasFocused` との比較でフォーカスが変わった回だけ発火する）。
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [wasFocused, setWasFocused] = useState(isFocusedWorkspace);
  if (isFocusedWorkspace !== wasFocused) {
    setWasFocused(isFocusedWorkspace);
    if (isFocusedWorkspace) setUserToggled(null);
  }
  const expanded = userToggled ?? isFocusedWorkspace;

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

  const branches = new Set<string>();
  for (const pane of workspace.panes) {
    if (pane.isMain || !pane.branch) continue;
    branches.add(pane.branch);
  }

  function target() {
    return focusedPane ?? workspace.panes[0] ?? null;
  }

  function handleClick() {
    const t = target();
    if (t) onSelectPane(t.paneId);
  }

  function handleOpenDiff() {
    const t = target();
    if (t) onOpenDiff(t.paneId);
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
          <div className="flex w-full items-center gap-0.5">
            <button
              type="button"
              onClick={() => setUserToggled(!expanded)}
              aria-expanded={expanded}
              aria-label={expanded ? "折りたたむ" : "展開する"}
              className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
            <button
              type="button"
              onClick={handleClick}
              aria-current={isFocusedWorkspace ? "true" : undefined}
              title="フォーカスを移す（ターミナルも切り替わります）"
              data-testid={`workspace-row-${workspace.workspaceId}`}
              className={cn(
                "flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
                isFocusedWorkspace && "bg-sidebar-accent font-medium",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{workspace.workspaceLabel}</span>
              {[...branches].map((branch) => (
                <Badge key={branch} variant="outline" className="h-4 px-1 text-[10px]">
                  {branch}
                </Badge>
              ))}
              {SUMMARY_STATUSES.map((status) => {
                const count = counts[status];
                if (count === 0) return null;
                return <AgentStatusDot key={status} status={status} label={String(count)} />;
              })}
              {agentCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  <Bot className="size-3" aria-label="agent 数" />
                  {agentCount}
                </span>
              )}
              {isFocusedWorkspace && (
                <span
                  data-testid="focus-dot"
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-focus"
                />
              )}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleClick}>フォーカスを移す</ContextMenuItem>
          <ContextMenuItem onSelect={openRename}>名前を変更</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleOpenDiff}>Diff を開く</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={openDelete}>
            削除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {expanded && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
          {workspace.panes.map((pane) => (
            <PaneRow
              key={pane.paneId}
              pane={pane}
              focused={pane.paneId === focusedPaneId}
              sessionId={pane.paneId === focusedPaneId ? focusedAgentSessionId : null}
              onSelect={onSelectPane}
            />
          ))}
        </div>
      )}

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
