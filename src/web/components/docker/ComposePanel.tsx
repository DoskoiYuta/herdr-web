// Read-only Compose tab (F11; renamed from "Docker" — ui-redesign.md §5.4,
// the tab is really a list of compose projects / devcontainers, not raw
// containers). Polls at a fixed 5s interval regardless of tab visibility
// elsewhere (unmounted while hidden, per the Tabs component) — deliberately
// not `repoChangedTick`/`subRepoPollMs`, since container state has nothing
// to do with git. API path (`/api/docker/...`) and the `docker-*` lib names
// are unchanged.

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { AlertTriangle, Box, Inbox, Layers, Plug, RefreshCw } from "lucide-react";
import type { DockerContainer, DockerGroup, DockerGroupKind } from "@contract/docker";
import { CommandTimeoutError, CommandUnavailableError, dockerApi } from "@/lib/api";
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

function GroupHeaderRow({ group }: { group: DockerGroup }) {
  const Icon = KIND_ICON[group.kind];
  const { running, exited } = groupCounts(group.containers);
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell colSpan={5} className="bg-muted/40 text-xs">
        <span className="inline-flex items-center gap-2">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{group.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            {KIND_LABEL[group.kind]}
          </span>
          <span className="text-muted-foreground">
            {running} running · {exited} exited
          </span>
        </span>
      </TableCell>
    </TableRow>
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
        <span className="font-mono">{c.service ?? ""}</span>{" "}
        <span className="text-muted-foreground">{c.name}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <StateDot state={c.state} />
        {c.status}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        {c.ports.length > 0 ? c.ports.map((p) => `${p.host}→${p.container}/${p.proto}`).join(" ") : "—"}
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

function ContainerLogsRow({ root, id }: { root: string; id: string }) {
  return (
    <TableRow>
      <TableCell colSpan={5} className="border-l-[3px] p-0 [border-left-color:var(--focus)]">
        <DockerLogsView root={root} id={id} />
      </TableCell>
    </TableRow>
  );
}

function errorPanelState(error: unknown, onRetry: () => void) {
  if (error instanceof CommandUnavailableError) {
    return <PanelState icon={Plug} title={error.message} tone="error" />;
  }
  return (
    <PanelState
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
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {errorMessage(query.error)}
          {query.dataUpdatedAt > 0 && `（${secondsAgo(query.dataUpdatedAt)}秒前の一覧を表示中）`}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {showFullError ? (
          errorPanelState(query.error, () => void query.refetch())
        ) : query.isPending ? (
          <PanelState icon={RefreshCw} title="読み込み中…" />
        ) : groups.length === 0 ? (
          <PanelState
            icon={Inbox}
            title="この worktree に紐づくコンテナはありません（compose / devcontainer のラベルで判定）"
          />
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-full text-xs">Service</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">State</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">Ports</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">Image</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">Uptime</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={`${group.kind}:${group.name}`}>
                  <GroupHeaderRow group={group} />
                  {group.containers.map((c) => (
                    <Fragment key={c.id}>
                      <ContainerRow
                        container={c}
                        expanded={expandedId === c.id}
                        onToggle={() => setExpandedId((prev) => (prev === c.id ? null : c.id))}
                      />
                      {expandedId === c.id && <ContainerLogsRow root={root} id={c.id} />}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

export default ComposePanel;
