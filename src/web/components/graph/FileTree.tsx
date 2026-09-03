import { useState } from "react";
import type React from "react";
import type { TreeNode } from "./tree";
import type { FileStatus } from "@contract/git";

const STATUS_LABEL: Record<FileStatus, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "conflict",
};

const STATUS_CLASS: Record<FileStatus, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  M: "text-amber-600 dark:text-amber-400",
  D: "text-red-600 dark:text-red-400",
  R: "text-sky-600 dark:text-sky-400",
  C: "text-sky-600 dark:text-sky-400",
  T: "text-muted-foreground",
  U: "text-destructive",
};

export interface FileTreeProps {
  nodes: TreeNode[];
}

export default function FileTree({ nodes }: FileTreeProps) {
  return (
    <ul className="flex flex-col text-sm" role="tree">
      {nodes.map((node) => (
        <FileTreeItem key={node.path} node={node} depth={0} />
      ))}
    </ul>
  );
}

// Rows are nested <ul>s for the tree semantics, but the stats column must
// line up at the left edge regardless of depth. Each row exposes --depth;
// the name column is indented by depth*indent via inline style below.
function depthStyle(depth: number): React.CSSProperties {
  return { ["--depth" as string]: String(depth) } as React.CSSProperties;
}

const INDENT_PX = 14;

function FileTreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true);

  if (node.kind === "file") {
    const f = node.file!;
    return (
      <li
        className="flex items-center gap-2 rounded-sm px-1 py-0.5 font-mono text-xs hover:bg-muted/50"
        role="treeitem"
        style={depthStyle(depth)}
      >
        <span className="flex w-16 shrink-0 items-center gap-1.5 tabular-nums">
          <span
            className={`w-3 text-center font-semibold ${STATUS_CLASS[f.status]}`}
            title={STATUS_LABEL[f.status]}
          >
            {f.status}
          </span>
          {f.additions === null ? (
            <span className="text-muted-foreground">bin</span>
          ) : (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>
              <span className="text-red-600 dark:text-red-400">−{f.deletions}</span>
            </>
          )}
        </span>
        <span style={{ paddingLeft: depth * INDENT_PX }}>
          {node.name}
          {f.oldPath && <span className="text-muted-foreground"> ← {f.oldPath}</span>}
        </span>
      </li>
    );
  }

  return (
    <li className="flex flex-col" role="treeitem" aria-expanded={open} style={depthStyle(depth)}>
      <div
        className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 font-mono text-xs hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-16 shrink-0" aria-hidden="true" />
        <span style={{ paddingLeft: depth * INDENT_PX }}>
          <span className="mr-1 inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
          {node.name}
        </span>
      </div>
      {open && (
        <ul role="group">
          {(node.children ?? []).map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
