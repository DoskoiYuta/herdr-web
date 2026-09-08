// Read-only Compose tab (F11; renamed from "Docker" — ui-redesign.md §5.4,
// the tab is really a list of compose projects / devcontainers, not raw
// containers). Polls at a fixed 5s interval regardless of tab visibility
// elsewhere (unmounted while hidden, per the Tabs component) — deliberately
// not `repoChangedTick`/`subRepoPollMs`, since container state has nothing
// to do with git. API path (`/api/docker/...`) and the `docker-*` lib names
// are unchanged.

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronRight,
  PackageX,
  Layers,
  Plug,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import type { DockerContainer, DockerGroup, DockerGroupKind } from "@contract/docker";
import {
  CommandFailedError,
  CommandTimeoutError,
  CommandUnavailableError,
  dockerApi,
} from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PanelState } from "@/components/ui/status/PanelState";
import { formatElapsedSince } from "@/lib/elapsed";
import { cn } from "@/lib/utils";
import { DockerLogsView } from "./DockerLogsView";

const POLL_MS = 5000;

export interface ComposePanelProps {
  root: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function secondsAgo(timestamp: number): number {
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

const KIND_ICON: Record<DockerGroupKind, typeof Layers> = {
  compose: Layers,
  devcontainer: Box,
};

const KIND_LABEL: Record<DockerGroupKind, string> = {
  compose: "docker compose",
  devcontainer: "devcontainer",
};

const SUMMARY_KIND_LABEL: Record<DockerGroupKind, string> = {
  compose: "compose プロジェクト",
  devcontainer: "devcontainer",
};

function projectSummary(groups: DockerGroup[]): string {
  const parts = (["compose", "devcontainer"] as const)
    .map((kind) => ({ kind, count: groups.filter((g) => g.kind === kind).length }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${SUMMARY_KIND_LABEL[kind]} ${count}`);
  return `この worktree の ${parts.join(" · ")}`;
}

function groupCounts(containers: DockerContainer[]): { running: number; exited: number } {
  let running = 0;
  let exited = 0;
  for (const c of containers) {
    if (c.state === "running") running += 1;
    else exited += 1;
  }
  return { running, exited };
}

function StateDot({ state }: { state: string }) {
  const color =
    state === "running"
      ? "bg-emerald-500"
      : state === "exited"
        ? "bg-muted-foreground"
        : "bg-amber-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
    </span>
  );
}

function GroupCardHeader({ group }: { group: DockerGroup }) {
  const Icon = KIND_ICON[group.kind];
  const { running, exited } = groupCounts(group.containers);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{group.name}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
        {KIND_LABEL[group.kind]}
      </span>
      <span className="flex-1" />
      <span className="text-muted-foreground">
        {running} running · {exited} exited
      </span>
    </div>
  );
}

function ContainerRow({
  container: c,
  expanded,
  onToggle,
}: {
  container: DockerContainer;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "cursor-pointer",
        expanded && "bg-accent border-l-[3px]",
        expanded && "[border-left-color:var(--focus)]",
      )}
    >
      <TableCell className="whitespace-nowrap text-xs">
        <span className="inline-flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="flex flex-col leading-tight">
            <span className="font-medium">{c.service ?? ""}</span>
            <span className="font-mono text-muted-foreground">{c.name}</span>
          </span>
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <StateDot state={c.state} />
        {c.status}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        {c.ports.length > 0
          ? c.ports.map((p) => `${p.host} → ${p.container}/${p.proto}`).join(" ")
          : "—"}
      </TableCell>
      <TableCell className="max-w-0 text-xs text-muted-foreground">
        <span className="block truncate" title={c.image}>
          {c.image}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatElapsedSince(c.createdAt) ?? ""}
      </TableCell>
    </TableRow>
  );
}

function ContainerLogsRow({
  root,
  id,
  name,
  onClose,
}: {
  root: string;
  id: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={5} className="border-l-[3px] p-0 [border-left-color:var(--focus)]">
        <DockerLogsView root={root} id={id} name={name} onClose={onClose} />
      </TableCell>
    </TableRow>
  );
}

function ComposeGroupCard({
  group,
  root,
  expandedId,
  onToggle,
}: {
  group: DockerGroup;
  root: string;
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border">
      <GroupCardHeader group={group} />
      <Table>
        <TableHeader className="bg-background">
          <TableRow>
            <TableHead className="w-full text-xs">Service</TableHead>
            <TableHead className="w-px whitespace-nowrap text-xs">State</TableHead>
            <TableHead className="w-px whitespace-nowrap text-xs">Ports</TableHead>
            <TableHead className="w-px whitespace-nowrap text-xs">Image</TableHead>
            <TableHead className="w-px whitespace-nowrap text-xs">Up</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.containers.map((c) => (
            <Fragment key={c.id}>
              <ContainerRow
                container={c}
                expanded={expandedId === c.id}
                onToggle={() => onToggle(c.id)}
              />
              {expandedId === c.id && (
                <ContainerLogsRow
                  root={root}
                  id={c.id}
                  name={c.name}
                  onClose={() => onToggle(c.id)}
                />
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** `CommandFailedError` は `docker` の非ゼロ終了全般（daemon 不達に限らない）
 * で投げられる — 「Docker を起動してください」は daemon 不達のときだけ足す。
 * それ以外は detail をそのまま見せ、detail が空でも「（503）」だけにはしない。 */
function commandFailedDescription(detail: string): string {
  if (detail.includes("Cannot connect to the Docker daemon")) {
    return `${detail}（503）。Docker を起動してください。`;
  }
  return detail.length > 0 ? `${detail}（503）。` : "docker コマンドが失敗しました（503）。";
}

function errorPanelState(error: unknown, onRetry: () => void) {
  if (error instanceof CommandUnavailableError) {
    return (
      <PanelState
        card
        icon={PackageX}
        title={error.message}
        description="PATH に docker コマンドがありません（501）。Docker Desktop または docker CLI をインストールしてください。"
        tone="error"
      />
    );
  }
  if (error instanceof CommandFailedError) {
    return (
      <PanelState
        card
        icon={Plug}
        title={error.title}
        description={commandFailedDescription(error.detail)}
        tone="error"
        action={{ label: "再試行", onClick: onRetry }}
      />
    );
  }
  return (
    <PanelState
      card
      icon={AlertTriangle}
      title={errorMessage(error)}
      tone="error"
      action={{ label: "再試行", onClick: onRetry }}
    />
  );
}

export function ComposePanel({ root }: ComposePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["docker-containers", root],
    queryFn: () => dockerApi.containers(root),
    enabled: root !== "",
    refetchInterval: POLL_MS,
    retry: false,
  });

  if (root === "") {
    return <PanelState icon={Plug} title="worktree を選択してください" />;
  }

  const groups = query.data?.groups ?? [];
  const hasStaleData = query.data !== undefined;
  // 前回値がある状態でのエラー（典型的にはタイムアウト）は、一覧を消さず
  // 上部の警告バーだけにする — 一覧そのものが無いエラー（コマンド不在 /
  // daemon 不達）はセンター寄せの空状態に切り替える。
  const showInlineWarning = query.isError && hasStaleData;
  const showFullError = query.isError && !hasStaleData;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showInlineWarning && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {query.error instanceof CommandTimeoutError
            ? `タイムアウト${query.dataUpdatedAt > 0 ? ` · ${secondsAgo(query.dataUpdatedAt)}秒前の結果` : ""}`
            : `${errorMessage(query.error)}${
                query.dataUpdatedAt > 0
                  ? `（${secondsAgo(query.dataUpdatedAt)}秒前の一覧を表示中）`
                  : ""
              }`}
        </div>
      )}
      {groups.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
          <span>{projectSummary(groups)}</span>
          <span className="inline-flex items-center gap-1">
            5 秒ごとに更新
            <RefreshCw
              className={cn("size-3", query.isFetching && "animate-spin")}
              aria-hidden="true"
            />
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {showFullError ? (
          errorPanelState(query.error, () => void query.refetch())
        ) : query.isPending ? (
          <PanelState icon={RefreshCw} title="読み込み中…" />
        ) : groups.length === 0 ? (
          <PanelState
            card
            icon={PackageSearch}
            title="この worktree に紐づくコンテナはありません"
            description="compose の working_dir または devcontainer の local_folder がこの worktree 配下にあるコンテナを表示します。"
          />
        ) : (
          <div className="flex flex-col gap-2 p-2">
            {groups.map((group) => (
              <ComposeGroupCard
                key={`${group.kind}:${group.name}`}
                group={group}
                root={root}
                expandedId={expandedId}
                onToggle={(id) => setExpandedId((prev) => (prev === id ? null : id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ComposePanel;
