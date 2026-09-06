// Pure ppid -> tree builder for ProcessPanel. The server response is flat
// (contract/proc.ts) since ancestry belongs to the view, not the wire
// format.

import type { ProcessInfo } from "@contract/proc";

export interface ProcessTreeNode {
  process: ProcessInfo;
  children: ProcessTreeNode[];
}

/** Builds a forest from `processes`' ppid links: a process whose `ppid`
 * isn't itself in `processes` becomes a root (its real parent is outside
 * root, e.g. herdr's own pane shell). A `ppid` pointing back into an
 * already-visited ancestor (a ps race producing a bogus loop) is treated as
 * a root instead of recursing forever. */
export function buildProcessTree(processes: ProcessInfo[]): ProcessTreeNode[] {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const nodes = new Map<number, ProcessTreeNode>(
    processes.map((p) => [p.pid, { process: p, children: [] }]),
  );

  function isAncestor(candidateAncestorPid: number, pid: number): boolean {
    const seen = new Set<number>();
    let current: number | undefined = pid;
    while (current !== undefined) {
      if (current === candidateAncestorPid) return true;
      if (seen.has(current)) return false; // already-cyclic path, bail
      seen.add(current);
      current = byPid.get(current)?.ppid;
    }
    return false;
  }

  const roots: ProcessTreeNode[] = [];
  for (const p of processes) {
    const node = nodes.get(p.pid);
    if (!node) continue;
    const parent = byPid.has(p.ppid) ? nodes.get(p.ppid) : undefined;
    if (parent && !isAncestor(p.pid, p.ppid)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
