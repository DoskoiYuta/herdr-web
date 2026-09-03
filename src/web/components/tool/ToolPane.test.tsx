import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ToolPane } from "./ToolPane";

// Radix `Tabs.Trigger` activates on `mousedown`, not `click` (see
// @radix-ui/react-tabs) — `fireEvent.click` alone never dispatches a
// `mousedown`, so switching tabs in jsdom needs this helper.
function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

vi.mock("@/components/diff/DiffPanel", () => ({
  DiffPanel: ({ repo, from, to }: { repo: string; from?: string; to?: string }) => (
    <div data-testid="diff-panel-stub">
      {repo}:{from ?? "WORKTREE"}:{to ?? "HEAD"}
    </div>
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
}));

describe("ToolPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
