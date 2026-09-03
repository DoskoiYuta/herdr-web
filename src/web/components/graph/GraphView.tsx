import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualizerOptions } from "@tanstack/react-virtual";
import { layoutGraph } from "./layout/layout";
import { GEOM } from "./layout/path";
import type { Commit, Ref } from "@contract/git";
import GraphRow from "./GraphRow";

export interface GraphViewHandle {
  scrollToIndex(index: number, opts?: { align?: "start" | "center" | "end" | "auto" }): void;
}

export interface GraphViewProps {
  commits: Commit[];
  refsByHash: Map<string, Ref[]>;
  headHash: string | null;
  selectedHash: string | null;
  /** Whether the selected row's commit detail is expanded inline. */
  detailOpen?: boolean;
  /** Repo the expanded detail block should fetch from. */
  repo?: string;
  /** Note shown in the expanded detail block for the selected row (e.g. root commit). */
  detailNote?: string;
  onSelect(hash: string, event: { shiftKey: boolean }): void;
  /** Called when the inline detail block's close button is clicked. */
  onCloseDetail?(): void;
  /**
   * Escape hatch for tests: react-virtual measures its scroll container via
   * ResizeObserver, which jsdom never fires (height stays 0 and no rows
   * render). Tests pass an explicit `initialRect` (and/or a stub
   * `getScrollElement`) here so rows show up without a real layout engine.
   */
  virtualizerOptions?: Partial<VirtualizerOptions<HTMLDivElement, Element>>;
}

const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(function GraphView(
  {
    commits,
    refsByHash,
    headHash,
    selectedHash,
    detailOpen = false,
    repo = "",
    detailNote,
    onSelect,
    onCloseDetail,
    virtualizerOptions,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(
    () => layoutGraph({ commits: commits.map((c) => ({ hash: c.hash, parents: c.parents })) }),
    [commits],
  );

  const commitByHash = useMemo(() => {
    const map = new Map<string, Commit>();
    for (const c of commits) map.set(c.hash, c);
    return map;
  }, [commits]);

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GEOM.rowHeight,
    overscan: 10,
    ...virtualizerOptions,
  });

  // Rows are fixed-height (24px) except the one currently expanded inline,
  // which react-virtual measures via `measureElement`'s ResizeObserver.
  // That observer only fires on subsequent size *changes* of an already
  // mounted node — the first time a row expands/collapses its measured
  // element identity is unchanged (same DOM node, different children), so
  // force a re-measure explicitly whenever which row is expanded changes.
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash, detailOpen]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, opts) {
        virtualizer.scrollToIndex(index, opts);
      },
    }),
    [virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="h-full overflow-auto" ref={scrollRef} role="grid">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualItems.map((item) => {
          const row = layout.rows[item.index];
          if (!row) return null;
          const commit = commitByHash.get(row.hash);
          if (!commit) return null;
          const expanded = detailOpen && row.hash === selectedHash;
          return (
            <div
              key={row.hash}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              <GraphRow
                row={row}
                laneCount={layout.laneCount}
                commit={commit}
                refs={refsByHash.get(row.hash) ?? []}
                isHead={row.hash === headHash}
                selected={row.hash === selectedHash}
                expanded={expanded}
                repo={repo}
                detailNote={detailNote}
                onSelect={onSelect}
                onCloseDetail={onCloseDetail}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default GraphView;
