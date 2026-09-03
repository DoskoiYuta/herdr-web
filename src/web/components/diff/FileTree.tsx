// Ported from terminal-diff's src/client/components/FileTree.tsx,
// restyled with Tailwind utility classes instead of raw CSS.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "./tree.ts";

export interface FileTreeProps {
  nodes: TreeNode[];
  activeId: string | null;
  onSelect(id: string): void;
  collapsed: Set<string>;
  onToggleDir(path: string): void;
  width?: number;
}

const STATUS_COLOR: Record<string, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  M: "text-amber-600 dark:text-amber-400",
  D: "text-red-600 dark:text-red-400",
  R: "text-blue-600 dark:text-blue-400",
  U: "text-muted-foreground",
};

function statsText(additions: number, deletions: number): string {
  const parts: string[] = [];
  if (additions > 0) parts.push(`+${additions}`);
  if (deletions > 0) parts.push(`−${deletions}`); // U+2212 minus sign
  return parts.join(" ");
}

export default function FileTree({
  nodes,
  activeId,
  onSelect,
  collapsed,
  onToggleDir,
  width,
}: FileTreeProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!activeId) return;
    const el = rowRefs.current.get(activeId);
    // jsdom (unit tests) doesn't implement scrollIntoView at all.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  function renderNodes(list: TreeNode[], depth: number) {
    return list.map((node) =>
      node.kind === "dir" ? renderDir(node, depth) : renderFile(node, depth),
    );
  }

  function renderDir(node: Extract<TreeNode, { kind: "dir" }>, depth: number) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={`dir:${node.path}`}>
        <div
          className="tree-row tree-dir flex cursor-pointer items-center gap-1 py-0.5 text-sm hover:bg-muted"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="tree-chevron w-3 text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
          <span className="tree-label truncate">{node.label}</span>
        </div>
        {!isCollapsed && renderNodes(node.children, depth + 1)}
      </div>
    );
  }

  function renderFile(node: Extract<TreeNode, { kind: "file" }>, depth: number) {
    const active = node.id === activeId;
    const stats = statsText(node.additions, node.deletions);
    return (
      <div
        key={`file:${node.id}`}
        ref={(el) => {
          if (el) rowRefs.current.set(node.id, el);
          else rowRefs.current.delete(node.id);
        }}
        className={cn(
          "tree-row tree-file flex cursor-pointer items-center gap-1.5 py-0.5 text-sm hover:bg-muted",
          `status-${node.status}`,
          active && "active bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(node.id)}
      >
        <span
          className={cn("tree-status w-3 shrink-0 font-mono text-xs", STATUS_COLOR[node.status])}
        >
          {node.status}
        </span>
        <span className="tree-label min-w-0 flex-1 truncate">{node.label}</span>
        {stats && (
          <span className="tree-stats shrink-0 text-xs text-muted-foreground">{stats}</span>
        )}
      </div>
    );
  }

  return (
    <div
      id="file-tree"
      className="file-tree h-full overflow-y-auto"
      style={width != null ? { width } : undefined}
    >
      {renderNodes(nodes, 0)}
    </div>
  );
}
