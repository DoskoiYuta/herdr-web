import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import type { LayoutInput } from "./layout";

describe("layoutGraph", () => {
  it("empty input -> empty output", () => {
    const out = layoutGraph({ commits: [] });
    expect(out).toEqual({ rows: [], laneCount: 0 });
  });

  it("linear history: all rows on lane 0", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "c1", parents: ["c2"] },
        { hash: "c2", parents: ["c3"] },
        { hash: "c3", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    expect(out.laneCount).toBe(1);
    expect(out.rows).toEqual([
      {
        hash: "c1",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 0, toLane: 0, color: 0, kind: "to-parent" }],
      },
      {
        hash: "c2",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 0, toLane: 0, color: 0, kind: "to-parent" }],
      },
      { hash: "c3", lane: 0, color: 0, segments: [] },
    ]);
  });

  it("divergence then convergence on a shared parent (branch point)", () => {
    // Two independent tips (m2, m1) both parented on `base`.
    const input: LayoutInput = {
      commits: [
        { hash: "m2", parents: ["base"] },
        { hash: "m1", parents: ["base"] },
        { hash: "base", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    expect(out.laneCount).toBe(2);
    expect(out.rows).toEqual([
      {
        hash: "m2",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 0, toLane: 0, color: 0, kind: "to-parent" }],
      },
      {
        hash: "m1",
        lane: 1,
        color: 1,
        segments: [
          { fromLane: 1, toLane: 1, color: 1, kind: "to-parent" },
          { fromLane: 0, toLane: 0, color: 0, kind: "pass" },
        ],
      },
      {
        hash: "base",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 1, toLane: 0, color: 1, kind: "merge-in" }],
      },
    ]);
  });

  it("merge commit (2 parents), each parent inherits its own lane, then converge at shared grandparent", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "merge", parents: ["p1", "p2"] },
        { hash: "p1", parents: ["base"] },
        { hash: "p2", parents: ["base"] },
        { hash: "base", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    expect(out.laneCount).toBe(2);
    expect(out.rows).toEqual([
      {
        hash: "merge",
        lane: 0,
        color: 0,
        segments: [
          { fromLane: 0, toLane: 0, color: 0, kind: "to-parent" },
          { fromLane: 0, toLane: 1, color: 1, kind: "to-parent" },
        ],
      },
      {
        hash: "p1",
        lane: 0,
        color: 0,
        segments: [
          { fromLane: 0, toLane: 0, color: 0, kind: "to-parent" },
          { fromLane: 1, toLane: 1, color: 1, kind: "pass" },
        ],
      },
      {
        hash: "p2",
        lane: 1,
        color: 1,
        segments: [
          { fromLane: 1, toLane: 1, color: 1, kind: "to-parent" },
          { fromLane: 0, toLane: 0, color: 0, kind: "pass" },
        ],
      },
      {
        hash: "base",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 1, toLane: 0, color: 1, kind: "merge-in" }],
      },
    ]);
  });

  it("octopus merge: extra parent already awaited by an existing lane is reused (no new lane)", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "x", parents: ["p2"] },
        { hash: "merge", parents: ["p1", "p2", "p3"] },
      ],
    };
    const out = layoutGraph(input);
    // lane0: x -> p2 ; lane1: merge -> p1 ; lane2: merge -> p3 (new)
    expect(out.laneCount).toBe(3);
    expect(out.rows).toEqual([
      {
        hash: "x",
        lane: 0,
        color: 0,
        segments: [{ fromLane: 0, toLane: 0, color: 0, kind: "to-parent" }],
      },
      {
        hash: "merge",
        lane: 1,
        color: 1,
        segments: [
          { fromLane: 1, toLane: 1, color: 1, kind: "to-parent" },
          { fromLane: 1, toLane: 0, color: 0, kind: "to-parent" },
          { fromLane: 1, toLane: 2, color: 2, kind: "to-parent" },
          { fromLane: 0, toLane: 0, color: 0, kind: "pass" },
        ],
      },
    ]);
  });

  it("multiple roots: a finished lane is reused by a later, unrelated chain (laneCount stays 1)", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "b", parents: ["a"] },
        { hash: "a", parents: [] },
        { hash: "d", parents: ["c"] },
        { hash: "c", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    expect(out.laneCount).toBe(1);
    for (const row of out.rows) {
      expect(row.lane).toBe(0);
    }
    expect(out.rows.map((r) => r.hash)).toEqual(["b", "a", "d", "c"]);
    // 'a' terminates the first chain (no parents -> no segment).
    expect(out.rows[1]!.segments).toEqual([]);
    // 'd' starts a fresh lane reusing index 0.
    expect(out.rows[2]!.segments).toEqual([
      { fromLane: 0, toLane: 0, color: out.rows[2]!.color, kind: "to-parent" },
    ]);
  });

  it("UNCOMMITTED pseudo-commit as first row, parented on HEAD", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "UNCOMMITTED", parents: ["head1"] },
        { hash: "head1", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    expect(out.laneCount).toBe(1);
    expect(out.rows[0]).toEqual({
      hash: "UNCOMMITTED",
      lane: 0,
      color: 0,
      segments: [{ fromLane: 0, toLane: 0, color: 0, kind: "to-parent" }],
    });
    expect(out.rows[1]).toEqual({ hash: "head1", lane: 0, color: 0, segments: [] });
  });

  it("truncated history: a parent hash absent from the commit list does not throw, lane stays open through the last row", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "c1", parents: ["c2"] },
        { hash: "c2", parents: ["missing-ancestor"] },
      ],
    };
    expect(() => layoutGraph(input)).not.toThrow();
    const out = layoutGraph(input);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[1]!.lane).toBe(0);
    expect(out.rows[1]!.segments).toEqual([
      { fromLane: 0, toLane: 0, color: 0, kind: "to-parent" },
    ]);
  });

  it("invariant: lane is within [0, laneCount) for every row, across all fixtures", () => {
    const fixtures: LayoutInput[] = [
      { commits: [] },
      {
        commits: [
          { hash: "merge", parents: ["p1", "p2", "p3"] },
          { hash: "p1", parents: ["base"] },
          { hash: "p2", parents: ["base"] },
          { hash: "p3", parents: ["base"] },
          { hash: "base", parents: [] },
        ],
      },
    ];
    for (const fixture of fixtures) {
      const out = layoutGraph(fixture);
      for (const row of out.rows) {
        expect(row.lane).toBeGreaterThanOrEqual(0);
        expect(row.lane).toBeLessThan(out.laneCount === 0 ? 1 : out.laneCount);
      }
    }
  });

  it("invariant: a lane occupied at the bottom of row i is occupied at the top of row i+1 (no gaps at row boundaries)", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "merge", parents: ["p1", "p2"] },
        { hash: "p1", parents: ["base"] },
        { hash: "p2", parents: ["base"] },
        { hash: "base", parents: [] },
      ],
    };
    const out = layoutGraph(input);
    for (let i = 0; i < out.rows.length - 1; i++) {
      // Every segment's toLane is where a line lands at the bottom of the row;
      // that lane must be picked back up at the top of the next row.
      const bottomLanes = new Set(out.rows[i]!.segments.map((s) => s.toLane));
      const topLanesNext = new Set(out.rows[i + 1]!.segments.map((s) => s.fromLane));
      topLanesNext.add(out.rows[i + 1]!.lane);
      for (const lane of bottomLanes) {
        expect(topLanesNext.has(lane)).toBe(true);
      }
    }
  });

  it("is deterministic for the same input", () => {
    const input: LayoutInput = {
      commits: [
        { hash: "merge", parents: ["p1", "p2"] },
        { hash: "p1", parents: ["base"] },
        { hash: "p2", parents: ["base"] },
        { hash: "base", parents: [] },
      ],
    };
    const a = layoutGraph(input);
    const b = layoutGraph(input);
    expect(a).toEqual(b);
  });
});

describe("lane closed and reopened in the same row", () => {
  it("does not emit a spurious pass line for a lane that merges in and is immediately reused", () => {
    // a and b are both children of m; m is itself a merge of x and p.
    // Lane 1 (waiting for m) closes into lane 0 at row m, then is reused
    // for the new parent p. That lane must carry merge-in + to-parent only.
    const out = layoutGraph({
      commits: [
        { hash: "a", parents: ["m"] },
        { hash: "b", parents: ["m"] },
        { hash: "m", parents: ["x", "p"] },
        { hash: "p", parents: [] },
        { hash: "x", parents: [] },
      ],
    });
    const m = out.rows[2]!;
    expect(m.lane).toBe(0);
    const kinds = m.segments.map((s) => `${s.kind}:${s.fromLane}->${s.toLane}`).sort();
    expect(kinds).toEqual(["merge-in:1->0", "to-parent:0->0", "to-parent:0->1"]);
    expect(m.segments.some((s) => s.kind === "pass")).toBe(false);
  });
});
