import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GraphPanel } from "./GraphPanel";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";

const commit = (hash: string, parents: string[]) => ({
  hash,
  parents,
  authorName: "a",
  authorEmail: "a@x",
  authorDate: 1,
  committerName: "a",
  committerDate: 1,
  subject: `subject ${hash}`,
  body: "",
});

vi.mock("@/lib/api", () => ({
  gitApi: {
    graph: vi.fn(async () => ({
      repo: "/r",
      commits: [commit("bbb", ["aaa"]), commit("aaa", [])],
      refs: [],
      head: { hash: "bbb", branch: "main", detached: false },
      stashes: [],
      hasUncommitted: false,
      truncated: false,
      generatedAt: 0,
    })),
    commit: vi.fn(async () => ({ ...commit("bbb", ["aaa"]), committerEmail: "a@x", files: [] })),
  },
}));

const virtualizerOptions = {
  initialRect: { width: 600, height: 400 },
  getScrollElement: () => null,
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
};

describe("GraphPanel detail toggle", () => {
  test("clicking the selected commit again closes its detail", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <GraphPanel
            repo="/r"
            repoChangedTick={0}
            onSelectCommit={() => {}}
            virtualizerOptions={virtualizerOptions}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = await screen.findByText("subject bbb");
    fireEvent.click(row);
    expect(await screen.findByRole("region", { name: "commit detail" })).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByRole("region", { name: "commit detail" })).toBeNull();
  });
});
