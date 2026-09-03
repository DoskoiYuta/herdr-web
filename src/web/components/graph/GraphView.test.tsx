import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import GraphView from "./GraphView";
import type { Commit, Ref } from "@contract/git";

function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return {
    hash: "a".repeat(40),
    parents: [],
    author: "yuta",
    authorEmail: "yuta@example.com",
    authorDate: Math.floor(Date.now() / 1000),
    committer: "yuta",
    commitDate: Math.floor(Date.now() / 1000),
    subject: "Fix foo",
    body: "",
    ...overrides,
  };
}

// jsdom never fires ResizeObserver, so react-virtual's default measurement
// would report a 0-height viewport and render nothing. This test suite only
// cares about what's in the DOM once rows exist, not about real pixel
// heights, so a fixed viewport + a fixed (non-zero) measureElement is
// enough per the task's own guidance on stubbing the virtualizer in jsdom.
const virtualizerOptions = {
  observeElementRect: (
    _instance: unknown,
    cb: (rect: { width: number; height: number }) => void,
  ) => {
    cb({ width: 800, height: 600 });
    return () => {};
  },
  measureElement: () => 24,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const HASH1 = "c1".padEnd(40, "0");
const HASH2 = "c2".padEnd(40, "0");
const commits = [
  makeCommit({ hash: HASH1, parents: [HASH2] }),
  makeCommit({ hash: HASH2, parents: [] }),
];

function renderGraphView(overrides: Partial<React.ComponentProps<typeof GraphView>> = {}) {
  const refsByHash = new Map<string, Ref[]>();
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...commits[0], files: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const utils = render(
    <GraphView
      commits={commits}
      refsByHash={refsByHash}
      headHash={null}
      selectedHash={null}
      detailOpen={false}
      repo=""
      onSelect={() => {}}
      virtualizerOptions={virtualizerOptions}
      {...overrides}
    />,
    { wrapper },
  );
  return { ...utils, fetchMock };
}

describe("GraphView inline commit detail", () => {
  test("does not render a detail block when nothing is expanded", () => {
    const { container } = renderGraphView();
    expect(container.querySelector(".graph-row-detail")).toBeNull();
  });

  test("renders the detail block directly under the expanded row, and no other row", () => {
    const { container } = renderGraphView({
      selectedHash: HASH1,
      detailOpen: true,
    });

    const details = container.querySelectorAll(".graph-row-detail");
    expect(details.length).toBe(1);
    expect(details[0]!.getAttribute("data-hash")).toBe(HASH1);

    // It must be the sibling immediately after the expanded row's own
    // 24px header div (same wrapper), not appended elsewhere in the tree.
    const headerRow = container.querySelector(`[data-hash="${HASH1}"].graph-row`)!;
    expect(headerRow.nextElementSibling).toBe(details[0]!);
  });

  test("a non-expanded, non-selected row renders no detail block", () => {
    const { container } = renderGraphView({
      selectedHash: HASH2,
      detailOpen: false,
    });
    expect(container.querySelector(".graph-row-detail")).toBeNull();
  });

  test("the gutter SVG has one <line> per segment, each anchored at the segment toLane x position", () => {
    const { container } = renderGraphView({
      selectedHash: HASH1,
      detailOpen: true,
    });

    const gutterSvg = container.querySelector(".graph-row-detail-gutter-svg")!;
    expect(gutterSvg).toBeTruthy();
    const lines = gutterSvg.querySelectorAll("line");

    // c1 -> c2 lays out as a single lane (lane 0) with one to-parent segment.
    expect(lines.length).toBe(1);
    const laneWidth = 16;
    const expectedX = String((0 + 0.5) * laneWidth);
    expect(lines[0]!.getAttribute("x1")).toBe(expectedX);
    expect(lines[0]!.getAttribute("x2")).toBe(expectedX);
    expect(lines[0]!.getAttribute("y2")).toBe("100%");
  });
});
