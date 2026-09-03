// Pure function turning a flat CommitFile[] (as returned by
// gitApi.commit()) into a nested tree for FileTree.tsx to render.
// No DOM, no React — kept testable in isolation (tree.test.ts).

import type { CommitFile } from "@contract/git";

export interface TreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
  file?: CommitFile;
}

interface MutableDir {
  name: string;
  path: string;
  children: Map<string, MutableDir | MutableFile>;
}

interface MutableFile {
  name: string;
  path: string;
  file: CommitFile;
}

function isDir(n: MutableDir | MutableFile): n is MutableDir {
  return "children" in n;
}

export function buildFileTree(files: CommitFile[]): TreeNode[] {
  const root: MutableDir = { name: "", path: "", children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/").filter((p) => p.length > 0);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const path = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;

      if (isLast) {
        cur.children.set(name, { name, path, file });
        continue;
      }

      let child = cur.children.get(name);
      if (!child || !isDir(child)) {
        child = { name, path, children: new Map() };
        cur.children.set(name, child);
      }
      cur = child;
    }
  }

  return finalize(root.children);
}

function finalize(children: Map<string, MutableDir | MutableFile>): TreeNode[] {
  const nodes = Array.from(children.values()).map(toTreeNode);
  nodes.sort(compareNodes);
  return nodes;
}

function toTreeNode(n: MutableDir | MutableFile): TreeNode {
  if (!isDir(n)) {
    return { name: n.name, path: n.path, kind: "file", file: n.file };
  }

  // Collapse a chain of directories that each hold exactly one
  // subdirectory and nothing else (GitHub-style path compaction), e.g.
  // src/ -> client/ -> components/ becomes a single "src/client/components" node.
  let name = n.name;
  let path = n.path;
  let children = n.children;
  while (children.size === 1) {
    const only = Array.from(children.values())[0]!;
    if (!isDir(only)) break;
    name = `${name}/${only.name}`;
    path = only.path;
    children = only.children;
  }

  return { name, path, kind: "dir", children: finalize(children) };
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}
