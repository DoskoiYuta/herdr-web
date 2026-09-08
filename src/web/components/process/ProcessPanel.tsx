// Read-only Process tab. Polls at a fixed 3s interval — deliberately not
// `repoChangedTick`/`subRepoPollMs`, since process state has nothing to do
// with git.

import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { AlertTriangle, PackageSearch, PackageX, Plug, RefreshCw } from "lucide-react";
import type { ProcessInfo } from "@contract/proc";
import {
  CommandFailedError,
  CommandTimeoutError,
  CommandUnavailableError,
  procApi,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PanelState } from "@/components/ui/status/PanelState";
import { formatElapsedSeconds } from "@/lib/elapsed";
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

function processCount(tree: ProcessTreeNode[]): number {
  return tree.reduce((sum, node) => sum + 1 + processCount(node.children), 0);
}

function listenPortCount(tree: ProcessTreeNode[]): number {
  return tree.reduce(
    (sum, node) => sum + node.process.listen.length + listenPortCount(node.children),
    0,
  );
}

function ProcessRow({ node, depth }: { node: ProcessTreeNode; depth: number }) {
  const p: ProcessInfo = node.process;
  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap text-xs">
          {p.listen.map((l) => (
            <Badge
              key={l.port}
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 font-mono text-emerald-600 dark:text-emerald-400"
            >
              :{l.port}
            </Badge>
          ))}
        </TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
          {p.pid}
        </TableCell>
        <TableCell className="relative max-w-0 text-xs">
          {/* ガイドは絶対配置で行の全高を覆う: td の高さは同じ行の他セル（Port の
           * chip など）で決まるので、flex の stretch では届かない。 */}
          <div aria-hidden className="absolute inset-y-0 left-0 flex">
            {Array.from({ length: depth }, (_, i) => (
              <span key={i} data-testid="indent-guide" className="w-3.5 border-l border-border" />
            ))}
          </div>
          <span
            className="block truncate font-mono"
            style={{ paddingLeft: depth * 14 }}
            title={p.command}
          >
            {p.command}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">{p.cpu.toFixed(1)}%</TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">
          {(p.rss / 1024).toFixed(0)}M
        </TableCell>
        <TableCell className="whitespace-nowrap text-right text-xs">
          {formatElapsedSeconds(p.elapsedSec)}
        </TableCell>
      </TableRow>
      {node.children.map((child) => (
        <ProcessRow key={child.process.pid} node={child} depth={depth + 1} />
      ))}
    </Fragment>
  );
}

function errorPanelState(error: unknown, onRetry: () => void) {
  if (error instanceof CommandUnavailableError) {
    return (
      <PanelState
        card
        icon={PackageX}
        title={error.message}
        description="PATH に ps / lsof コマンドがありません（501）。インストールされているか確認してください。"
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
        description={
          error.detail.length > 0
            ? `${error.detail}（503）。`
            : "プロセス一覧の取得に失敗しました（503）。"
        }
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

export function ProcessPanel({ root }: ProcessPanelProps) {
  const query = useQuery({
    queryKey: ["proc-list", root],
    queryFn: () => procApi.list(root),
    enabled: root !== "",
    refetchInterval: POLL_MS,
    retry: false,
  });

  if (root === "") {
    return <PanelState icon={Plug} title="worktree を選択してください" />;
  }

  const processes = query.data?.processes ?? [];
  const tree = buildProcessTree(processes);
  const hasStaleData = query.data !== undefined;
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
      {tree.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
          <span>
            {`${processCount(tree)} プロセス · LISTEN ${listenPortCount(tree)} ポート · cwd がこの worktree 配下`}
          </span>
          <span>3 秒ごとに更新</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {showFullError ? (
          errorPanelState(query.error, () => void query.refetch())
        ) : query.isPending ? (
          <PanelState icon={RefreshCw} title="読み込み中…" />
        ) : tree.length === 0 ? (
          <PanelState
            card
            icon={PackageSearch}
            title="この worktree を cwd とするプロセスはありません"
            description="cwd がこの worktree 配下にあるプロセスをここに表示します。"
          />
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
