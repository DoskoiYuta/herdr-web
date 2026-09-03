import { test } from "vitest";
import assert from "node:assert/strict";
import { orderItemsByTree } from "./order.ts";
import { buildTree } from "./tree.ts";
import type { TreeEntry } from "./tree.ts";

function entry(id: string, name: string): TreeEntry {
  return { id, name, status: "M", additions: 1, deletions: 1 };
}

test("orderItemsByTree: reorders patch-order items to match the tree's dirs-first/alphabetical order", () => {
  // git patch order: z.ts, then a/b.ts, then a.ts (deliberately not tree order).
  const items = [
    { id: "diff:z.ts#1", name: "z.ts" },
    { id: "diff:a/b.ts#1", name: "a/b.ts" },
    { id: "diff:a.ts#1", name: "a.ts" },
  ];
  const treeNodes = buildTree([
    entry("diff:z.ts#1", "z.ts"),
    entry("diff:a/b.ts#1", "a/b.ts"),
    entry("diff:a.ts#1", "a.ts"),
  ]);

  const ordered = orderItemsByTree(items, treeNodes);
  assert.deepEqual(
    ordered.map((i) => i.id),
    ["diff:a/b.ts#1", "diff:a.ts#1", "diff:z.ts#1"],
  );
});

test("orderItemsByTree: preserves object identity (no cloning)", () => {
  const a = { id: "diff:a.ts#1", name: "a.ts" };
  const b = { id: "diff:b.ts#1", name: "b.ts" };
  const items = [a, b];
  const treeNodes = buildTree([entry(b.id, b.name), entry(a.id, a.name)]);

  const ordered = orderItemsByTree(items, treeNodes);
  assert.equal(ordered[0], a);
  assert.equal(ordered[1], b);
});

test("orderItemsByTree: items missing from the tree are appended last, original order preserved", () => {
  const items = [
    { id: "diff:a.ts#1", name: "a.ts" },
    { id: "diff:ghost.ts#1", name: "ghost.ts" },
    { id: "diff:b.ts#1", name: "b.ts" },
  ];
  // Tree built without the "ghost" entry (simulates a stale/unmapped item).
  const treeNodes = buildTree([entry("diff:b.ts#1", "b.ts"), entry("diff:a.ts#1", "a.ts")]);

  const ordered = orderItemsByTree(items, treeNodes);
  assert.deepEqual(
    ordered.map((i) => i.id),
    ["diff:a.ts#1", "diff:b.ts#1", "diff:ghost.ts#1"],
  );
});

test("orderItemsByTree: empty items -> empty result", () => {
  assert.deepEqual(orderItemsByTree([], []), []);
});
