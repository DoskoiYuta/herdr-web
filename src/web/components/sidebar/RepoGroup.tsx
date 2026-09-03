import { ChevronRight, CircleCheck, OctagonAlert, Plus } from "lucide-react";
import { useState } from "react";
import type { Repo } from "@contract/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { herdrApi } from "@/lib/api";
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
 * `repository > worktree > pane` ではなく `repository > workspace`（leaf 行）。
 *
 * ヘッダーには「ワークスペースを作成」ボタンも出す。クリックするとインライン
 * フォーム（ラベル入力、既定値はリポジトリ名）が開き、そのリポジトリの main
 * worktree root を cwd として `workspace.create` を呼ぶ（focus: true — 作成した
 * ワークスペースをすぐ操作対象にする）。作成に成功すれば herdr が
 * `workspace_created` イベントを流し、サイドバーはそれで自然に更新される。 */
export function RepoGroup({
  repo,
  displayName,
  pinnedWorktreeRoot,
  collapsed,
  onToggleCollapse,
  onSelectPane,
}: RepoGroupProps) {
  const workspaces = groupByWorkspace(repo);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState(repo.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mainRoot = repo.worktrees.find((w) => w.isMain)?.root ?? repo.worktrees[0]?.root ?? null;

  function openCreateForm(e: React.MouseEvent) {
    e.stopPropagation();
    setLabel(repo.name);
    setError(null);
    setCreating(true);
  }

  function closeCreateForm() {
    setCreating(false);
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!mainRoot) {
      setError("worktree が見つかりません");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await herdrApi.createWorkspace({
        cwd: mainRoot,
        label: label.trim() || repo.name,
        focus: true,
      });
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ワークスペースの作成に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          data-testid={`repo-header-${repo.key}`}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-semibold"
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
        <button
          type="button"
          onClick={openCreateForm}
          aria-label="ワークスペースを作成"
          data-testid={`create-workspace-${repo.key}`}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="ml-3 flex flex-col gap-1 border-l border-border py-1 pl-2"
        >
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ワークスペース名"
            aria-label="ワークスペース名"
            disabled={submitting}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-1">
            <Button type="submit" size="sm" disabled={submitting}>
              作成
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeCreateForm}>
              キャンセル
            </Button>
          </div>
        </form>
      )}

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
