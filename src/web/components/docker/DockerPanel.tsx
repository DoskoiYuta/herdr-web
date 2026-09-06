// Read-only Docker tab. Polls at a fixed 5s interval regardless of tab
// visibility state elsewhere (unmounted while hidden, per the Tabs
// component) — deliberately not `repoChangedTick`/`subRepoPollMs`, since
// container state has nothing to do with git.

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import type { DockerContainer, DockerGroup } from "@contract/docker";
import { dockerApi } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DockerLogsView } from "./DockerLogsView";

const POLL_MS = 5000;

export interface DockerPanelProps {
  root: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function secondsAgo(timestamp: number): number {
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
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
      {state}
    </span>
  );
}

function GroupHeaderRow({ group }: { group: DockerGroup }) {
  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell colSpan={6} className="bg-muted/40 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{group.kind}</span>
          <span className="font-medium">{group.name}</span>
          <span className="truncate text-muted-foreground" title={group.workingDir}>
            {group.workingDir}
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
    <TableRow onClick={onToggle} aria-expanded={expanded} className="cursor-pointer">
      <TableCell className="whitespace-nowrap font-mono text-xs">{c.service ?? ""}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <StateDot state={c.state} />
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        {c.ports.map((p) => `${p.host}→${p.container}/${p.proto}`).join(" ")}
      </TableCell>
      <TableCell className="max-w-0 text-xs">
        <span className="block truncate" title={c.image}>
          {c.image}
        </span>
      </TableCell>
      <TableCell className="max-w-0 text-xs text-muted-foreground">
        <span className="block truncate" title={c.name}>
          {c.name}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{c.status}</TableCell>
    </TableRow>
  );
}

function ContainerLogsRow({ root, id }: { root: string; id: string }) {
  return (
    <TableRow>
      <TableCell colSpan={6} className="p-0">
        <DockerLogsView root={root} id={id} />
      </TableCell>
    </TableRow>
  );
}

export function DockerPanel({ root }: DockerPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["docker-containers", root],
    queryFn: () => dockerApi.containers(root),
    enabled: root !== "",
    refetchInterval: POLL_MS,
    retry: false,
  });

  if (root === "") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <p className="p-2 text-sm text-muted-foreground">worktree を選択してください</p>
      </div>
    );
  }

  const groups = query.data?.groups ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {query.isError && (
        <p className="shrink-0 border-b border-border px-2 py-1 text-xs text-destructive">
          {errorMessage(query.error)}
          {query.dataUpdatedAt > 0 && `（${secondsAgo(query.dataUpdatedAt)}秒前の一覧を表示中）`}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {query.isPending ? (
          <p className="p-2 text-sm text-muted-foreground">読み込み中…</p>
        ) : groups.length === 0 && !query.isError ? (
          <p className="p-2 text-sm text-muted-foreground">
            この worktree に紐づくコンテナはありません（compose / devcontainer のラベルで判定）
          </p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-px whitespace-nowrap text-xs">Service</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">State</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">Ports</TableHead>
                <TableHead className="w-full text-xs">Image</TableHead>
                <TableHead className="w-px whitespace-nowrap text-xs">Name</TableHead>
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

export default DockerPanel;
