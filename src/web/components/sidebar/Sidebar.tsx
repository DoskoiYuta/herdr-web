import { useMemo, useState } from "react";
import { CircleCheck, OctagonAlert, PanelLeft } from "lucide-react";
import type { Repo } from "@contract/events";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/lib/layout";
import { repoDisplayNames } from "@/lib/repoDisplay";
import { buildWorkspaceView } from "@/lib/workspaceView";
import type { AskEvent } from "@/lib/askEvent";
import { RepoGroup } from "./RepoGroup";
import type { AskFileLocation } from "./AskSessionGroup";
import { WorkspaceGroup } from "./WorkspaceGroup";

export type SidebarMode = "repository" | "workspace";

export type SidebarLayout = { width: number; collapsed: boolean };

export type SidebarProps = {
  repos: Repo[];
  herdrConnected: boolean;
  connection: "connecting" | "open" | "reconnecting" | "closed";
  pinnedWorktreeRoot: string | null;
  focusedWorkspaceId: string | null;
  onSelectPane: (paneId: string) => void;
  layout: SidebarLayout;
  onLayoutChange: (next: SidebarLayout) => void;
  /** 質問セッション行の「対象ファイルを開く」（F10 の右クリックメニュー）。 */
  onOpenAskFile: (location: AskFileLocation) => void;
  subscribeAskEvents?: (cb: (event: AskEvent) => void) => () => void;
};

const CONNECTION_LABEL: Record<SidebarProps["connection"], string> = {
  connecting: "接続中…",
  open: "接続済み",
  reconnecting: "再接続中…",
  closed: "切断",
};

/** plan.md F8: `repository > workspace`（既定。workspace が leaf 行）/
 * `workspace > tab > pane` の 2 モードを持つサイドバー。折りたたみ可能でアイコン
 * レールになり、幅はドラッグで変更できる。 */
export function Sidebar({
  repos,
  herdrConnected,
  connection,
  pinnedWorktreeRoot,
  focusedWorkspaceId,
  onSelectPane,
  layout,
  onLayoutChange,
  onOpenAskFile,
  subscribeAskEvents,
}: SidebarProps) {
  const [mode, setMode] = useState<SidebarMode>("repository");
  const [collapsedRepos, setCollapsedRepos] = useState<ReadonlySet<string>>(new Set());
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<string>>(new Set());
  const [liveWidth, setLiveWidth] = useState(layout.width);

  const displayNames = useMemo(() => repoDisplayNames(repos), [repos]);
  const workspaceView = useMemo(() => buildWorkspaceView(repos), [repos]);
  const totals = useMemo(
    () =>
      repos.reduce(
        (acc, r) => ({ blocked: acc.blocked + r.counts.blocked, done: acc.done + r.counts.done }),
        { blocked: 0, done: 0 },
      ),
    [repos],
  );

  const toggleRepo = (key: string) => setCollapsedRepos((prev) => toggleInSet(prev, key));
  const toggleWorkspace = (id: string) => setCollapsedWorkspaces((prev) => toggleInSet(prev, id));

  if (layout.collapsed) {
    return (
      <aside
        className="flex h-full w-10 shrink-0 flex-col items-center gap-2 border-r border-border py-2"
        aria-label="サイドバー（折りたたみ）"
      >
        <button
          type="button"
          onClick={() => onLayoutChange({ ...layout, collapsed: false })}
          aria-label="サイドバーを開く"
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <PanelLeft className="size-4" />
        </button>
        {!herdrConnected && (
          <span className="size-2 rounded-full bg-destructive" aria-label="herdr 未接続" />
        )}
        {totals.blocked > 0 && (
          <Badge variant="destructive" className="gap-0.5 px-1">
            <OctagonAlert className="size-3" aria-hidden="true" />
            {totals.blocked}
          </Badge>
        )}
        {totals.done > 0 && (
          <Badge variant="secondary" className="gap-0.5 px-1 text-green-600 dark:text-green-400">
            <CircleCheck className="size-3" aria-hidden="true" />
            {totals.done}
          </Badge>
        )}
      </aside>
    );
  }

  return (
    <div className="flex h-full shrink-0">
      <aside
        className="flex h-full flex-col overflow-hidden border-r border-border text-sm"
        style={{ width: liveWidth }}
        aria-label="サイドバー"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as SidebarMode)}
            size="sm"
          >
            <ToggleGroupItem value="repository" aria-label="リポジトリ表示">
              リポジトリ
            </ToggleGroupItem>
            <ToggleGroupItem value="workspace" aria-label="ワークスペース表示">
              ワークスペース
            </ToggleGroupItem>
          </ToggleGroup>
          <button
            type="button"
            onClick={() => onLayoutChange({ ...layout, collapsed: true })}
            aria-label="サイドバーを折りたたむ"
            className="shrink-0 rounded-md p-1 hover:bg-muted"
          >
            <PanelLeft className="size-4" />
          </button>
        </header>

        {!herdrConnected && (
          <div className="shrink-0 border-b border-border bg-destructive/10 px-2 py-1 text-xs text-destructive">
            herdr 未接続（{CONNECTION_LABEL[connection]}）
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {repos.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              {herdrConnected ? "pane がありません" : "herdr 未接続"}
            </p>
          )}

          {mode === "repository" &&
            repos.map((repo) => (
              <RepoGroup
                key={repo.key}
                repo={repo}
                displayName={displayNames.get(repo.key) ?? repo.name}
                pinnedWorktreeRoot={pinnedWorktreeRoot}
                focusedWorkspaceId={focusedWorkspaceId}
                collapsed={collapsedRepos.has(repo.key)}
                onToggleCollapse={() => toggleRepo(repo.key)}
                onSelectPane={onSelectPane}
                onOpenAskFile={onOpenAskFile}
                subscribeAskEvents={subscribeAskEvents}
              />
            ))}

          {mode === "workspace" &&
            workspaceView.map((workspace) => (
              <WorkspaceGroup
                key={workspace.workspaceId}
                workspace={workspace}
                collapsed={collapsedWorkspaces.has(workspace.workspaceId)}
                onToggleCollapse={() => toggleWorkspace(workspace.workspaceId)}
                onSelectPane={onSelectPane}
              />
            ))}
        </div>
      </aside>

      <ResizeHandle
        width={liveWidth}
        min={SIDEBAR_MIN_WIDTH}
        max={SIDEBAR_MAX_WIDTH}
        defaultWidth={SIDEBAR_DEFAULT_WIDTH}
        direction="right"
        onResize={setLiveWidth}
        onResizeEnd={(width) => onLayoutChange({ ...layout, width })}
      />
    </div>
  );
}

function toggleInSet<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
