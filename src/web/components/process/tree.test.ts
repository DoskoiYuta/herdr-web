import { describe, expect, test } from "vitest";
import type { ProcessInfo } from "@contract/proc";
import { buildProcessTree } from "./tree";

function proc(pid: number, ppid: number): ProcessInfo {
  return {
    pid,
    ppid,
    command: `p${pid}`,
    argv0: `p${pid}`,
    cpu: 0,
    rss: 0,
    elapsedSec: 0,
    cwd: "/r",
    listen: [],
  };
}

describe("buildProcessTree", () => {
  test("a process whose parent is also in the set becomes that parent's child", () => {
    const tree = buildProcessTree([proc(1, 0), proc(2, 1)]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.process.pid).toBe(1);
    expect(tree[0]?.children.map((c) => c.process.pid)).toEqual([2]);
  });

  test("a process whose parent is not in the set becomes a root", () => {
    const tree = buildProcessTree([proc(2, 1)]); // pid 1 (the real parent) is outside root

    expect(tree.map((n) => n.process.pid)).toEqual([2]);
  });

  test("a ppid cycle within the set does not loop forever and both processes surface", () => {
    const tree = buildProcessTree([proc(1, 2), proc(2, 1)]);

    const allPids = (nodes: ReturnType<typeof buildProcessTree>): number[] =>
      nodes.flatMap((n) => [n.process.pid, ...allPids(n.children)]);
    expect(allPids(tree).sort()).toEqual([1, 2]);
  });
});
