import { useMemo, useState } from "react";
import { Inbox as InboxIcon, PanelLeft, PlugZap, Settings as SettingsIcon } from "lucide-react";
import type { Repo } from "@contract/events";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useInboxCounts } from "@/components/inbox/hooks/useInboxCounts";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/lib/layout";
import { repoDisplayNames } from "@/lib/repoDisplay";
import { cn } from "@/lib/utils";
import { RepoGroup } from "./RepoGroup";
import type { AskFileLocation } from "./AskSessionRow";

export type SidebarLayout = { width: number; collapsed: boolean };

export type SidebarProps = {
  repos: Repo[];
  herdrConnected: boolean;
  connection: "connecting" | "open" | "reconnecting" | "closed";
  /** `state.herdr.protocol` — herdr のプロトコルバージョン、未接続なら null。 */
  protocol: number | null;
  focusedWorkspaceId: string | null;
  /** herdr で現在フォーカスされている pane（`state.focus.pane`）。 */
  focusedPaneId: string | null;
  /** フォーカス中 pane の `agentSession.value`。 */
  focusedAgentSessionId: string | null;
  onSelectPane: (paneId: string) => void;
  layout: SidebarLayout;
  onLayoutChange: (next: SidebarLayout) => void;
  /** 質問セッション行の「対象ファイルを開く」（F10 の右クリックメニュー）。 */
  onOpenAskFile: (location: AskFileLocation) => void;
  /** Workspace 行の右クリック「Diff を開く」。 */
  onOpenDiff: (paneId: string) => void;
  /** 上部の Inbox 項目クリック（Inbox ダイアログ本体は未実装、docs/ui-redesign.md §5.1）。 */
  onOpenInbox: () => void;
};

/**
 * `connection`（ブラウザ⇔サーバー WS）と `herdrConnected`（herdr 本体）は
 * 独立した状態 — 片方のラベルにもう片方の値を差し込むと「herdr
 * 未接続（接続済み）」のような矛盾した文言になる。WS が `open` でなければ
 * それを優先し、`open` なら herdr 側の状態で決める。
 */
function connectionStatus(
  connection: SidebarProps["connection"],
  herdrConnected: boolean,
): { ok: boolean; label: string } {
  if (connection !== "open") {
    const label =
      connection === "connecting"
        ? "サーバーに接続中…"
        : connection === "reconnecting"
          ? "再接続中…"
          : "切断";
    return { ok: false, label };
  }
  if (!herdrConnected) return { ok: false, label: "herdr 未接続（socket を待っています）" };
  return { ok: true, label: "herdr 接続済み" };
}

/** ui-redesign.md §4.2 D4/D5, §5.2: `Repository > Workspace > Pane` の 1 モード
 * サイドバー。上部に Inbox 項目、下部に herdr 接続状態のフッター。折りたたむと
 * アイコンレールになり、幅はドラッグで変更できる。 */
export function Sidebar({
  repos,
  herdrConnected,
  connection,
  protocol,
  focusedWorkspaceId,
  focusedPaneId,
  focusedAgentSessionId,
  onSelectPane,
  layout,
  onLayoutChange,
  onOpenAskFile,
  onOpenDiff,
  onOpenInbox,
}: SidebarProps) {
  const [collapsedRepos, setCollapsedRepos] = useState<ReadonlySet<string>>(new Set());
  const [liveWidth, setLiveWidth] = useState(layout.width);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inboxCounts = useInboxCounts();
  const status = connectionStatus(connection, herdrConnected);

  const displayNames = useMemo(() => repoDisplayNames(repos), [repos]);
  const totals = useMemo(
    () =>
      repos.reduce(
        (acc, r) => ({ blocked: acc.blocked + r.counts.blocked, done: acc.done + r.counts.done }),
        { blocked: 0, done: 0 },
      ),
    [repos],
  );

  const toggleRepo = (key: string) => setCollapsedRepos((prev) => toggleInSet(prev, key));

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
        <button
          type="button"
          onClick={onOpenInbox}
          aria-label={inboxCounts.data ? `Inbox ${inboxCounts.data} 件` : "Inbox"}
          className="rounded-md p-1"
        >
          <InboxIcon className="size-4" />
          {inboxCounts.data !== null && inboxCounts.data > 0 && (
            <Badge variant="outline" className="gap-0.5 px-1">
              {inboxCounts.data}
            </Badge>
          )}
        </button>
        {totals.blocked > 0 && <AgentStatusDot status="blocked" label={String(totals.blocked)} />}
        {totals.done > 0 && <AgentStatusDot status="done" label={String(totals.done)} />}
        <span
          className={cn("size-2 rounded-full", status.ok ? "bg-green-500" : "bg-destructive")}
          aria-label={status.label}
        />
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
          <button
            type="button"
            onClick={onOpenInbox}
            data-testid="inbox-item"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-muted"
          >
            <InboxIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Inbox</span>
            {inboxCounts.data !== null && inboxCounts.data > 0 && (
              <Badge variant="outline">{inboxCounts.data}</Badge>
            )}
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange({ ...layout, collapsed: true })}
            aria-label="サイドバーを折りたたむ"
            className="shrink-0 rounded-md p-1 hover:bg-muted"
          >
            <PanelLeft className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!status.ok && (
            <div
              data-testid="sidebar-empty-state"
              className="flex flex-col items-center gap-1 p-4 text-center text-xs text-muted-foreground"
            >
              <PlugZap className="size-5" aria-hidden="true" />
              <p>{status.label}</p>
            </div>
          )}

          {status.ok && repos.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">pane がありません</p>
          )}

          {status.ok &&
            repos.map((repo) => (
              <RepoGroup
                key={repo.key}
                repo={repo}
                displayName={displayNames.get(repo.key) ?? repo.name}
                focusedWorkspaceId={focusedWorkspaceId}
                focusedPaneId={focusedPaneId}
                focusedAgentSessionId={focusedAgentSessionId}
                collapsed={collapsedRepos.has(repo.key)}
                onToggleCollapse={() => toggleRepo(repo.key)}
                onSelectPane={onSelectPane}
                onOpenDiff={onOpenDiff}
                onOpenAskFile={onOpenAskFile}
              />
            ))}
        </div>

        <footer className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              status.ok ? "bg-green-500" : "bg-destructive",
            )}
            aria-label={status.label}
          />
          <span className="min-w-0 flex-1 truncate">
            {status.ok ? `herdr 接続済み · protocol ${protocol ?? "?"}` : status.label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="設定"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </footer>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

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
