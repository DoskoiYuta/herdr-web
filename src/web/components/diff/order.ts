// Pure helper: reorder CodeView items (git patch order) to match the
// FileTree's displayed order (tree.ts buildTree: directories first, then
// alphabetical). No DOM — testable with plain vitest.

import type { TreeNode } from "./tree.ts";

function flattenTreeIds(nodes: readonly TreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.kind === "file") ids.push(node.id);
    else ids.push(...flattenTreeIds(node.children));
  }
  return ids;
}

/**
 * Reorder `items` to match `treeNodes`'s flattened display order. Items with
 * no corresponding tree node (should not normally happen — tree.ts derives
 * its entries from the same items) are appended at the end, in their
 * original relative order, rather than dropped.
 *
 * Reuses the same item objects (no cloning) so callers can run this after
 * reconcile() without disturbing its object-identity guarantees.
 */
export function orderItemsByTree<T extends { id: string }>(
  items: readonly T[],
  treeNodes: readonly TreeNode[],
): T[] {
  const displayOrder = flattenTreeIds(treeNodes);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const ordered: T[] = [];

  for (const id of displayOrder) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  // Unknown items last, preserving their original relative order.
  for (const item of items) {
    if (byId.has(item.id)) ordered.push(item);
  }
  return ordered;
}
