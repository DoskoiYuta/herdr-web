// Read-only Process tab. Polls at a fixed 3s interval — deliberately not
// `repoChangedTick`/`subRepoPollMs`, since process state has nothing to do
// with git.

import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import type { ProcessInfo } from "@contract/proc";
import { procApi } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildProcessTree, type ProcessTreeNode } from "./tree";

const POLL_MS = 3000;

export interface ProcessPanelProps {
  root: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function secondsAgo(timestamp: number): number {
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${secs}s`;
  return `${secs}s`;
}

function ProcessRow({ node, depth }: { node: ProcessTreeNode; depth: number }) {
  const p: ProcessInfo = node.process;
  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap font-mono text-xs">
          {p.listen.map((l) => `:${l.port}`).join(" ")}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
          {p.pid}
        </TableCell>
        <TableCell className="max-w-0 text-xs" style={{ paddingLeft: depth * 16 + 8 }}>
          <span className="block truncate font-mono" title={p.command}>
            {depth > 0 ? `└ ${p.command}` : p.command}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">{p.cpu.toFixed(1)}%</TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">
          {(p.rss / 1024).toFixed(0)}M
        </TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">
          {formatElapsed(p.elapsedSec)}
        </TableCell>
      </TableRow>
      {node.children.map((child) => (
        <ProcessRow key={child.process.pid} node={child} depth={depth + 1} />
      ))}
    </Fragment>
  );
}

export function ProcessPanel({ root }: ProcessPanelProps) {
  const query = useQuery({
    queryKey: ["proc-list", root],
    queryFn: () => procApi.list(root),
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

  const processes = query.data?.processes ?? [];
  const tree = buildProcessTree(processes);

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
        ) : tree.length === 0 && !query.isError ? (
          <p className="p-2 text-sm text-muted-foreground">
            この worktree を cwd とするプロセスはありません
          </p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-px whitespace-nowrap text-xs">Port</TableHead>
                <TableHead className="w-px whitespace-nowrap text-right text-xs">PID</TableHead>
                <TableHead className="w-full text-xs">Command</TableHead>
                <TableHead className="w-px whitespace-nowrap text-right text-xs">CPU</TableHead>
                <TableHead className="w-px whitespace-nowrap text-right text-xs">Mem</TableHead>
                <TableHead className="w-px whitespace-nowrap text-right text-xs">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tree.map((node) => (
                <ProcessRow key={node.process.pid} node={node} depth={0} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

export default ProcessPanel;
