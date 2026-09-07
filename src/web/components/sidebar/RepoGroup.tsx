import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import type { Repo } from "@contract/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { herdrApi, askApi } from "@/lib/api";
import { useAskEvents } from "@/lib/HerdrStoreContext";
import { askEventMatchesRepo } from "@/lib/askEvent";
import { askWorkspacesFor, groupByWorkspace } from "@/lib/repoWorkspaces";
import { cn } from "@/lib/utils";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { AskSessionRow, type AskFileLocation } from "./AskSessionRow";
import { RepoWorkspaceRow } from "./RepoWorkspaceRow";

const ASK_STATUS_QUERY = "open,replied,outdated";
const ASK_LIST_REFETCH_MS = 30_000;

export type RepoGroupProps = {
  repo: Repo;
  /** basename が他リポジトリと衝突する場合、見出しに親ディレクトリも添える。 */
  displayName: string;
  focusedWorkspaceId: string | null;
  focusedPaneId: string | null;
  focusedAgentSessionId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectPane: (paneId: string) => void;
  onOpenDiff: (paneId: string) => void;
  /** 質問セッション行の「対象ファイルを開く」（F10 の右クリックメニュー）。 */
  onOpenAskFile: (location: AskFileLocation) => void;
};

/** ui-redesign.md §5.2: repository ヘッダーに名前と blocked/done 集計（ドット＋
 * 数字。Badge ではなく AgentStatusDot、色だけに頼らずアイコンも出す）を出し、
 * 折りたたみ可能にする。中身は `Repository > Workspace > Pane` の 3 段 —
 * ワークスペース行（`RepoWorkspaceRow`、質問セッションは `AskSessionRow`）を
 * 同じ段にフラットに並べる（別グループの折りたたみ枠は持たない）。
 *
 * ヘッダーには「ワークスペースを作成」ボタンも出す。クリックするとインライン
 * フォーム（ラベル入力、既定値はリポジトリ名）が開き、そのリポジトリの main
 * worktree root を cwd として `workspace.create` を呼ぶ（focus: true — 作成した
 * ワークスペースをすぐ操作対象にする）。作成に成功すれば herdr が
 * `workspace_created` イベントを流し、サイドバーはそれで自然に更新される。 */
export function RepoGroup({
  repo,
  displayName,
  focusedWorkspaceId,
  focusedPaneId,
  focusedAgentSessionId,
  collapsed,
  onToggleCollapse,
  onSelectPane,
  onOpenDiff,
  onOpenAskFile,
}: RepoGroupProps) {
  const workspaces = groupByWorkspace(repo);
  const askWorkspaces = askWorkspacesFor(repo);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState(repo.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const askListQuery = useQuery({
    queryKey: ["ask-list", repo.key],
    queryFn: () => askApi.list({ repo: repo.key, status: ASK_STATUS_QUERY }),
    staleTime: Infinity,
    refetchInterval: ASK_LIST_REFETCH_MS,
    enabled: askWorkspaces.length > 0,
  });
  useAskEvents(
    useCallback(
      (event) => {
        if (askEventMatchesRepo(event, repo.key)) {
          void queryClient.invalidateQueries({ queryKey: ["ask-list", repo.key] });
        }
      },
      [repo.key, queryClient],
    ),
  );
  const asks = askListQuery.data ?? [];

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
            <AgentStatusDot status="blocked" label={String(repo.counts.blocked)} />
          )}
          {repo.counts.done > 0 && (
            <AgentStatusDot status="done" label={String(repo.counts.done)} />
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
              focusedWorkspaceId={focusedWorkspaceId}
              focusedPaneId={focusedPaneId}
              focusedAgentSessionId={focusedAgentSessionId}
              onSelectPane={onSelectPane}
              onOpenDiff={onOpenDiff}
            />
          ))}
          {askWorkspaces.map((workspace) => (
            <AskSessionRow
              key={workspace.workspaceId}
              workspace={workspace}
              ask={asks.find(
                (a) => a.session?.kind === "herdr" && a.session.label === workspace.workspaceLabel,
              )}
              focusedPaneId={focusedPaneId}
              onSelectPane={onSelectPane}
              onOpenAskFile={onOpenAskFile}
              onResolved={() =>
                void queryClient.invalidateQueries({ queryKey: ["ask-list", repo.key] })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
