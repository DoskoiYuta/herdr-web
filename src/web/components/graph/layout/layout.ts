import { createColorAllocator } from "./colors";

/** Input commits, expected in topological order (children before parents). */
export interface LayoutInput {
  commits: { hash: string; parents: string[] }[];
}

export interface LayoutSegment {
  fromLane: number; // x position at the top edge of the row
  toLane: number; // x position at the bottom edge of the row
  color: number; // PALETTE index
  kind: "pass" | "to-parent" | "merge-in";
}

export interface LayoutRow {
  hash: string;
  lane: number; // this commit's node x position (lane index)
  color: number; // PALETTE index
  segments: LayoutSegment[];
}

export interface LayoutOutput {
  rows: LayoutRow[];
  laneCount: number;
}

/**
 * Pure "active lane" graph layout, ported from plan.md §6.3.
 *
 * `lanes[i]` holds the hash the lane is currently waiting for (or `null` if
 * the lane is free). Processing a commit:
 *  1. Seats the commit in the lane already waiting for its hash, or opens a
 *     new lane (reusing the leftmost free slot) if none is waiting.
 *  2. Closes any *other* lanes also waiting for this hash into the seat via
 *     a `merge-in` segment (handles converging branches / diamond merges).
 *  3. Extends a `to-parent` segment per parent: the first parent inherits
 *     the seat's lane and color; extra parents (merge commits) reuse an
 *     existing lane already waiting for that parent hash, or open a new one.
 *  4. Draws a `pass` segment for every other lane that was already active
 *     before this row and remains active after it, untouched by this row.
 *  4.5. Packs the lanes left, closing any gap left by a lane that just
 *     closed, so branches ending mid-history don't hold the grid at their
 *     old width.
 *  5. Trims trailing free lanes so finished branches don't keep the grid
 *     wide forever.
 */
export function layoutGraph(input: LayoutInput): LayoutOutput {
  const { commits } = input;
  if (commits.length === 0) {
    return { rows: [], laneCount: 0 };
  }

  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  const allocColor = createColorAllocator();
  const rows: LayoutRow[] = [];
  let laneCount = 0;

  const acquireFreeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    laneColor.push(-1);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const topLanes = lanes.slice();
    // Lanes that were closed or (re)opened by this row; they must not also
    // get a `pass` line even if they are active both before and after.
    const touched = new Set<number>();

    // 1. Seat the commit.
    let lane = lanes.findIndex((h) => h === commit.hash);
    if (lane < 0) {
      lane = acquireFreeLane();
      laneColor[lane] = allocColor();
    }
    const color = laneColor[lane]!;
    const segments: LayoutSegment[] = [];

    // 2. Any other lane waiting for the same hash converges here and closes.
    for (let j = 0; j < lanes.length; j++) {
      if (j === lane) continue;
      if (lanes[j] === commit.hash) {
        segments.push({ fromLane: j, toLane: lane, color: laneColor[j]!, kind: "merge-in" });
        lanes[j] = null;
        touched.add(j);
      }
    }

    // 3. Extend toward parents.
    const { parents } = commit;
    if (parents.length === 0) {
      lanes[lane] = null;
    } else {
      lanes[lane] = parents[0]!;
      segments.push({ fromLane: lane, toLane: lane, color, kind: "to-parent" });

      for (let pi = 1; pi < parents.length; pi++) {
        const p = parents[pi]!;
        let target = lanes.findIndex((h) => h === p);
        if (target >= 0 && target !== lane) {
          segments.push({
            fromLane: lane,
            toLane: target,
            color: laneColor[target]!,
            kind: "to-parent",
          });
        } else {
          target = acquireFreeLane();
          lanes[target] = p;
          laneColor[target] = allocColor();
          touched.add(target);
          segments.push({
            fromLane: lane,
            toLane: target,
            color: laneColor[target]!,
            kind: "to-parent",
          });
        }
      }
    }

    // 4. Pass-through lines: active before this row, still active after, and
    // not the commit's own seat (which already produced its segment(s) above).
    for (let j = 0; j < lanes.length; j++) {
      if (j === lane || touched.has(j)) continue;
      if (j < topLanes.length && topLanes[j] !== null && lanes[j] !== null) {
        segments.push({ fromLane: j, toLane: j, color: laneColor[j]!, kind: "pass" });
      }
    }

    // 4.5. Compact: pack still-active lanes leftward into any gap left by a
    // lane that just closed, so a branch that ended doesn't hold everything
    // to its right out at its old width for the rest of the graph. This
    // scan is a stable left-pack (every active lane ends up at the leftmost
    // free index, in original relative order); the commit's own seat
    // (`lane`, the node's drawn position) is never itself relocated, but its
    // `to-parent`/`merge-in` segments can still have their `toLane` remapped
    // below like any other lane's.
    const compacted = new Map<number, number>();
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] === null) continue;
      const free = lanes.indexOf(null);
      if (free >= 0 && free < j) {
        lanes[free] = lanes[j]!;
        laneColor[free] = laneColor[j]!;
        lanes[j] = null;
        compacted.set(j, free);
      }
    }
    if (compacted.size > 0) {
      for (const seg of segments) {
        const moved = compacted.get(seg.toLane);
        if (moved !== undefined) seg.toLane = moved;
      }
    }

    laneCount = Math.max(laneCount, lanes.length);
    rows.push({ hash: commit.hash, lane, color, segments });

    // 5. Trim trailing free lanes so finished branches don't keep the grid wide.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColor.pop();
    }
  }

  return { rows, laneCount };
}
