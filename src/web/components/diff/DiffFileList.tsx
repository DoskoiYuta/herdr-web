// The Diff tab's own left file list (design.pen P8/P11): a directory
// heading (folder icon + compacted path) followed by its files, each ending
// in a colored status letter — not the generic collapsible PathTree used by
// Files/Graph. Built directly on tree.ts's `TreeNode` (already compacts
// single-child directory chains), so no interactive expand/collapse state
// is needed: everything renders flat.
import { Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ADDITIONS_COLOR, DELETIONS_COLOR } from "@/components/tree/decorationColors";
import type { FileStatus, TreeNode } from "./tree.ts";

const STATUS_COLOR: Record<FileStatus, string> = {
  M: "text-amber-600 dark:text-amber-400",
  A: "text-emerald-600 dark:text-emerald-400",
  D: "text-red-600 dark:text-red-400",
  R: "text-blue-600 dark:text-blue-400",
  U: "text-muted-foreground",
};

function nodeMatches(node: TreeNode, query: string): boolean {
  if (node.kind === "file") return node.path.toLowerCase().includes(query);
  return node.children.some((child) => nodeMatches(child, query));
}

function filterNodes(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      if (nodeMatches(node, query)) out.push(node);
    } else {
      const children = filterNodes(node.children, query);
      if (children.length > 0) out.push({ ...node, children });
    }
  }
  return out;
}

function Rows({
  nodes,
  depth,
  selectedPath,
  onSelectFile,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string | null;
  onSelectFile(path: string): void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <div key={node.path}>
            <div
              className="flex items-center gap-1.5 truncate px-2 py-1 text-muted-foreground"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <Folder className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{node.path}</span>
            </div>
            <Rows
              nodes={node.children}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            aria-label={node.path}
            onClick={() => onSelectFile(node.path)}
            style={{ paddingLeft: 20 + depth * 12 }}
            className={cn(
              "flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-muted/50",
              selectedPath === node.path && "bg-primary/10",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            {(node.additions > 0 || node.deletions > 0) && (
              <span className="shrink-0 font-mono text-[11px]" aria-hidden>
                {node.additions > 0 && (
                  <span style={{ color: ADDITIONS_COLOR }}>+{node.additions}</span>
                )}
                {node.deletions > 0 && (
                  <span style={{ color: DELETIONS_COLOR }}> −{node.deletions}</span>
                )}
              </span>
            )}
            <span
              className={cn(
                "w-3 shrink-0 text-right font-mono font-semibold",
                STATUS_COLOR[node.status],
              )}
              aria-hidden
            >
              {node.status}
            </span>
          </button>
        ),
      )}
    </>
  );
}

export interface DiffFileListProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectFile(path: string): void;
  /** Search box above the rows (default on), compacted to a single small
   * input per ui-redesign.md §5.4. */
  search?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function DiffFileList({
  nodes,
  selectedPath,
  onSelectFile,
  search = true,
  className,
  style,
}: DiffFileListProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterNodes(nodes, query.trim().toLowerCase()), [nodes, query]);
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} style={style}>
      {search && (
        <div className="shrink-0 border-b border-border p-1">
          <Input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-6 text-xs"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto text-xs">
        <Rows nodes={filtered} depth={0} selectedPath={selectedPath} onSelectFile={onSelectFile} />
      </div>
    </div>
  );
}

export default DiffFileList;
