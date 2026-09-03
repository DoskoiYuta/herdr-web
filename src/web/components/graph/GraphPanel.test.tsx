import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GraphPanel } from "./GraphPanel";
import type { GraphResponse } from "@contract/git";

afterEach(() => {
  vi.unstubAllGlobals();
});

function hash(n: number): string {
  return `h${n}`.padEnd(40, "0");
}

// Newest-first, as the server's graph builder returns commits.
function makeGraph(): GraphResponse {
  const commits = [
    { hash: hash(0), parents: [hash(1)] },
    { hash: hash(1), parents: [hash(2)] },
    { hash: hash(2), parents: [] }, // root commit
  ].map((c, i) => ({
    ...c,
    author: "yuta",
    authorEmail: "yuta@example.com",
    authorDate: Math.floor(Date.now() / 1000) - i * 100,
    committer: "yuta",
    commitDate: Math.floor(Date.now() / 1000) - i * 100,
    subject: `commit ${i}`,
    body: "",
  }));

  return {
    repo: "/repo",
    commits,
    refs: [],
    head: { hash: commits[0]!.hash, detached: false, branch: "main" },
    stashes: [],
    hasUncommitted: false,
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
}

function setupFetchMock(graph: GraphResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/git/graph")) {
      return { ok: true, json: async () => graph } as Response;
    }
    if (url.includes("/api/git/commit/")) {
      const found = graph.commits.find((c) => url.includes(c.hash));
      return { ok: true, json: async () => ({ ...found, files: [] }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// jsdom never fires ResizeObserver, so react-virtual's default measurement
// would report a 0-height viewport and render nothing. Same workaround as
// GraphView.test.tsx.
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

describe("GraphPanel commit selection", () => {
  test("clicking a non-root commit selects it and reports {from: parent, to: hash}", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onSelectCommit = vi.fn();
    const { container } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={onSelectCommit}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(0)}"]`)).toBeTruthy());
    // Initial mount fires onSelectCommit(null) once via the repo-reset effect.
    onSelectCommit.mockClear();

    fireEvent.click(container.querySelector(`[data-hash="${hash(0)}"].graph-row`)!);

    expect(onSelectCommit).toHaveBeenCalledWith({ from: hash(1), to: hash(0) });
  });

  test("clicking the root commit does not report a range and shows the inline note", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onSelectCommit = vi.fn();
    const { container, findByText } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={onSelectCommit}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(2)}"]`)).toBeTruthy());
    onSelectCommit.mockClear();

    fireEvent.click(container.querySelector(`[data-hash="${hash(2)}"].graph-row`)!);

    expect(onSelectCommit).toHaveBeenCalledWith(null);
    await findByText("ルートコミットの diff は表示できません");
  });

  test("shift-click a second commit reports a range between the two, oldest as from", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onSelectCommit = vi.fn();
    const { container } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={onSelectCommit}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(0)}"]`)).toBeTruthy());

    fireEvent.click(container.querySelector(`[data-hash="${hash(1)}"].graph-row`)!);
    onSelectCommit.mockClear();
    fireEvent.click(container.querySelector(`[data-hash="${hash(0)}"].graph-row`)!, {
      shiftKey: true,
    });

    // h(0) is newer (earlier in the topological, newest-first array) than h(1).
    expect(onSelectCommit).toHaveBeenCalledWith({ from: hash(1), to: hash(0) });
  });

  test("shift-click with nothing selected yet behaves like a plain click", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onSelectCommit = vi.fn();
    const { container } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={onSelectCommit}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(0)}"]`)).toBeTruthy());
    onSelectCommit.mockClear();

    fireEvent.click(container.querySelector(`[data-hash="${hash(0)}"].graph-row`)!, {
      shiftKey: true,
    });

    expect(onSelectCommit).toHaveBeenCalledWith({ from: hash(1), to: hash(0) });
  });

  test("shows commit rows from the fetched graph", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={() => {}}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await screen.findByText("commit 0");
    await screen.findByText("commit 1");
    await screen.findByText("commit 2");
  });
});
