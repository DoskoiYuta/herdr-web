import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Review } from "@contract/review";
import type { ReviewEvent } from "@/lib/herdrStore";
import { ToolPane } from "./ToolPane";

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [{ seq: 0, author: "user", body: "check this", at: "t", agentSession: null }],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

// Radix `Tabs.Trigger` activates on `mousedown`, not `click` (see
// @radix-ui/react-tabs) — `fireEvent.click` alone never dispatches a
// `mousedown`, so switching tabs in jsdom needs this helper.
function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

// ToolPane's unresolved-review badge uses useReviewList (a TanStack Query
// hook), so every render needs a QueryClientProvider ancestor.
function render(ui: ReactElement) {
  const client = new QueryClient();
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let diffPanelMountCount = 0;
vi.mock("@/components/diff/DiffPanel", () => ({
  DiffPanel: ({ repo, from, to }: { repo: string; from?: string; to?: string }) => {
    useEffect(() => {
      diffPanelMountCount += 1;
    }, []);
    return (
      <div data-testid="diff-panel-stub">
        {repo}:{from ?? "WORKTREE"}:{to ?? "HEAD"}
      </div>
    );
  },
}));

vi.mock("@/components/review/ReviewPanel", () => ({
  ReviewPanel: ({ onNavigate }: { onNavigate: (nav: { routeToGraph: true }) => void }) => (
    <button
      type="button"
      data-testid="review-panel-stub"
      onClick={() => onNavigate({ routeToGraph: true })}
    >
      review
    </button>
  ),
}));

vi.mock("@/components/graph/GraphPanel", () => ({
  GraphPanel: ({
    onSelectCommit,
  }: {
    onSelectCommit: (range: { from: string; to: string } | null) => void;
  }) => (
    <button
      type="button"
      data-testid="graph-panel-stub"
      onClick={() => onSelectCommit({ from: "aaa111", to: "bbb222" })}
    >
      graph
    </button>
  ),
}));

const reviewListMock = vi.fn(async (..._args: unknown[]) => []);

vi.mock("@/lib/api", () => ({
  gitApi: {
    root: vi.fn(async (path: string) => ({
      root: path,
      commonDir: `${path}/.git`,
      branch: "main",
      isMain: true,
      head: "abc123",
      rootCommit: "abc123",
    })),
  },
  reviewApi: {
    list: (...args: unknown[]) => reviewListMock(...args),
  },
}));

describe("ToolPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diffPanelMountCount = 0;
  });

  test("remounts DiffPanel (fresh instance) when worktreeRoot changes, so no stale diff/annotations survive a focus switch", () => {
    const client = new QueryClient();
    const renderWith = (worktreeRoot: string, repoChangedTick: number) =>
      rtlRender(
        <QueryClientProvider client={client}>
          <ToolPane
            worktreeRoot={worktreeRoot}
            pinned={false}
            onPinToggle={vi.fn()}
            repoChangedTick={repoChangedTick}
            onOpenPath={vi.fn()}
          />
        </QueryClientProvider>,
      );

    const { rerender } = renderWith("/Users/dev/project-a", 0);
    expect(diffPanelMountCount).toBe(1);

    rerender(
      <QueryClientProvider client={client}>
        <ToolPane
          worktreeRoot="/Users/dev/project-b"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(diffPanelMountCount).toBe(2);
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project-b:WORKTREE:HEAD",
    );

    // rerendering with the same worktreeRoot/comparison doesn't remount
    rerender(
      <QueryClientProvider client={client}>
        <ToolPane
          worktreeRoot="/Users/dev/project-b"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={1}
          onOpenPath={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(diffPanelMountCount).toBe(2);
  });

  test("shows the empty state and an open-path form when no worktree is selected", () => {
    render(
      <ToolPane
        worktreeRoot={null}
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
      />,
    );
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.getByLabelText("リポジトリのパスを開く")).toBeInTheDocument();
  });

  test("submitting the open-path form resolves the root and lifts it up", async () => {
    const onOpenPath = vi.fn();
    render(
      <ToolPane
        worktreeRoot={null}
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={onOpenPath}
      />,
    );
    fireEvent.change(screen.getByLabelText("リポジトリのパスを開く"), {
      target: { value: "/tmp/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    await screen.findByRole("button", { name: "開く" });
    expect(onOpenPath).toHaveBeenCalledWith("/tmp/repo");
  });

  test("shows the worktree header, tabs, and pin toggle when a worktree is selected", () => {
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
      />,
    );
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("/Users/dev/project")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Graph" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:WORKTREE:HEAD",
    );
  });

  test("pin toggle calls onPinToggle and reflects pressed state", () => {
    const onPinToggle = vi.fn();
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={true}
        onPinToggle={onPinToggle}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
      />,
    );
    const pin = screen.getByLabelText("ピン留めを解除");
    expect(pin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pin);
    expect(onPinToggle).toHaveBeenCalled();
  });

  test("selecting a commit in the graph tab sets the diff comparison and shows a reset button", () => {
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
      />,
    );
    selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    selectTab("Diff");

    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:aaa111:bbb222",
    );
    const resetButton = screen.getByRole("button", { name: "作業ツリーに戻る" });
    fireEvent.click(resetButton);
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:WORKTREE:HEAD",
    );
  });

  test("shows the focused pane's agent/status and offers a claude --resume copy button", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
        focusInfo={{
          agent: "claude",
          agentStatus: "working",
          agentSession: { source: "herdr:claude", agent: "claude", kind: "id", value: "abc-123" },
        }}
      />,
    );
    expect(screen.getByText("claude · working")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "claude --resume abc-123" });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("claude --resume abc-123");
  });

  test("does not show a resume button for a non-claude agent session", () => {
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
        focusInfo={{
          agent: "codex",
          agentStatus: "idle",
          agentSession: { source: "herdr:codex", agent: "codex", kind: "path", value: "/tmp/x" },
        }}
      />,
    );
    expect(screen.getByText("codex · idle")).toBeInTheDocument();
    expect(screen.queryByText(/claude --resume/)).not.toBeInTheDocument();
  });

  test("switching worktreeRoot resets a picked commit comparison back to the working tree", () => {
    const client = new QueryClient();
    const { rerender } = rtlRender(
      <QueryClientProvider client={client}>
        <ToolPane
          worktreeRoot="/Users/dev/project-a"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />
      </QueryClientProvider>,
    );
    selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    selectTab("Diff");
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project-a:aaa111:bbb222",
    );

    rerender(
      <QueryClientProvider client={client}>
        <ToolPane
          worktreeRoot="/Users/dev/project-b"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project-b:WORKTREE:HEAD",
    );
  });

  test("a root-commit review navigation (routeToGraph) switches to the Graph tab instead of Diff", () => {
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
      />,
    );
    selectTab("Review");
    fireEvent.click(screen.getByTestId("review-panel-stub"));
    expect(screen.getByTestId("graph-panel-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-panel-stub")).not.toBeInTheDocument();
  });

  test("a review WS event for a different repo does not refetch the unresolved-count badge", async () => {
    let emit: ((event: ReviewEvent) => void) | undefined;
    const subscribeReviewEvents = vi.fn((cb: (event: ReviewEvent) => void) => {
      emit = cb;
      return () => {};
    });
    render(
      <ToolPane
        worktreeRoot="/Users/dev/project"
        repoKey="/Users/dev/project/.git"
        pinned={false}
        onPinToggle={vi.fn()}
        repoChangedTick={0}
        onOpenPath={vi.fn()}
        subscribeReviewEvents={subscribeReviewEvents}
      />,
    );
    await waitFor(() => expect(reviewListMock).toHaveBeenCalledTimes(1));

    emit?.({ type: "review", event: "created", review: review({ repo: "/other/.git" }) });
    expect(reviewListMock).toHaveBeenCalledTimes(1);

    emit?.({
      type: "review",
      event: "created",
      review: review({ repo: "/Users/dev/project/.git" }),
    });
    await waitFor(() => expect(reviewListMock).toHaveBeenCalledTimes(2));
  });
});
