import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { gitApi } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    gitApi: {
      ...actual.gitApi,
      graph: vi.fn(async () => ({
        repo: "/r",
        commits: [],
        refs: [],
        head: { hash: "", branch: "main", detached: false },
        stashes: [],
        hasUncommitted: false,
        truncated: false,
        generatedAt: "",
      })),
    },
  };
});

const { GraphPanel } = await import("./GraphPanel");

const virtualizerOptions = {
  initialRect: { width: 600, height: 400 },
  getScrollElement: () => null,
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GraphPanel branch scope toggle", () => {
  test("defaults to all branches", async () => {
    renderPanel();
    await waitFor(() =>
      expect(gitApi.graph).toHaveBeenCalledWith(expect.objectContaining({ all: true })),
    );
  });

  test("switching to '現在のブランチのみ' re-fetches with all:false", async () => {
    renderPanel();
    await waitFor(() => expect(gitApi.graph).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole("tab", { name: "現在のブランチのみ" }));

    await waitFor(() =>
      expect(gitApi.graph).toHaveBeenCalledWith(expect.objectContaining({ all: false })),
    );
  });
});
