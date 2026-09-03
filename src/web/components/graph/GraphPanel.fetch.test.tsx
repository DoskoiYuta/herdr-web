import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GraphPanel } from "./GraphPanel";
import { FetchBusyError, gitApi } from "@/lib/api";

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
      fetch: vi.fn(),
    },
  };
});

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
      <GraphPanel
        repo="/r"
        repoChangedTick={0}
        onSelectCommit={() => {}}
        virtualizerOptions={virtualizerOptions}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GraphPanel fetch", () => {
  test("clicking the fetch button calls gitApi.fetch(repo)", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 100,
      timedOut: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await waitFor(() => expect(gitApi.fetch).toHaveBeenCalledWith("/r"));
  });

  test("the button is disabled while the fetch is in flight", async () => {
    let resolveFetch: (value: Awaited<ReturnType<typeof gitApi.fetch>>) => void = () => {};
    vi.mocked(gitApi.fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderPanel();

    const button = screen.getByRole("button", { name: "origin を fetch" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    resolveFetch({ code: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  test("success shows 'fetch 完了 (Ns)' and refetches the graph", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 842,
      timedOut: false,
    });
    renderPanel();
    // Wait for the initial graph load before capturing the baseline call
    // count, so the assertion below isn't racing the mount's own fetch.
    await waitFor(() => expect(vi.mocked(gitApi.graph).mock.calls.length).toBeGreaterThan(0));
    const callsBefore = vi.mocked(gitApi.graph).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await screen.findByText(/fetch 完了 \(0\.8s\)/);
    await waitFor(() =>
      expect(vi.mocked(gitApi.graph).mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  test("success with stderr output appends a summary of it", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "From origin\n   abc123..def456  main -> origin/main\n",
      durationMs: 500,
      timedOut: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await screen.findByText(/fetch 完了 \(0\.5s\) — From origin/);
  });

  test("failure shows the first stderr line", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: 128,
      stdout: "",
      stderr:
        "fatal: unable to access 'https://example.com/repo.git/': Could not resolve host\nmore",
      durationMs: 30,
      timedOut: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await screen.findByText(
      "fatal: unable to access 'https://example.com/repo.git/': Could not resolve host",
    );
  });

  test("busy (FetchBusyError) shows '実行中です'", async () => {
    vi.mocked(gitApi.fetch).mockRejectedValue(new FetchBusyError());
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await screen.findByText("実行中です");
  });

  test("timedOut shows 'タイムアウト'", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: -1,
      stdout: "",
      stderr: "",
      durationMs: 120000,
      timedOut: true,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "origin を fetch" }));

    await screen.findByText("タイムアウト");
  });

  test("pressing 'f' while the graph container has focus triggers fetch", async () => {
    vi.mocked(gitApi.fetch).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
    });
    const { container } = renderPanel();

    const root = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(root, { key: "f" });

    await waitFor(() => expect(gitApi.fetch).toHaveBeenCalledWith("/r"));
  });
});
