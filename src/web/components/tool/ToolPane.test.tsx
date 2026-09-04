import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SubReposResponse } from "@contract/git";
import type { PaneRow, Repo } from "@contract/events";
import type { ReviewCountsResponse } from "@contract/review";
import type { ReviewEvent } from "@/lib/herdrStore";
import { ToolPane } from "./ToolPane";

function counts(overrides: Partial<ReviewCountsResponse> = {}): ReviewCountsResponse {
  return { byCommit: {}, worktree: { unresolved: 0, drafts: 0 }, pendingDrafts: 0, ...overrides };
}

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: "workspace 1",
    tabId: "t1",
    tabLabel: "tab 1",
    label: null,
    agent: "claude",
    agentStatus: "idle",
    terminalTitleStripped: null,
    focused: false,
    cwd: null,
    foregroundCwd: null,
    ...overrides,
  };
}

/** `repos` fixture: a single repo with one worktree at `root` holding `panes`. */
function reposWithPanes(root: string, panes: PaneRow[]): Repo[] {
  return [
    {
      key: `${root}/.git`,
      name: "project",
      worktrees: [{ root, branch: "main", isMain: true, panes }],
      counts: { blocked: 0, done: 0 },
    },
  ];
}

// Radix `Tabs.Trigger` activates on `mousedown`, not `click` (see
// @radix-ui/react-tabs) — `fireEvent.click` alone never dispatches a
// `mousedown`, so switching tabs in jsdom needs this helper.
function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

// ToolPane's review-counts query is a TanStack Query hook, so every render
// needs a QueryClientProvider ancestor.
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

vi.mock("@/components/graph/GraphPanel", () => ({
  GraphPanel: ({
    repo,
    onSelectCommit,
    reviewCounts,
  }: {
    repo: string;
    onSelectCommit: (range: { from: string; to: string } | null) => void;
    reviewCounts?: ReviewCountsResponse | null;
  }) => (
    <button
      type="button"
      data-testid="graph-panel-stub"
      onClick={() => onSelectCommit({ from: "aaa111", to: "bbb222" })}
    >
      graph:{repo}:{reviewCounts ? reviewCounts.pendingDrafts : "null"}
    </button>
  ),
}));

const countsMock = vi.fn(async (..._args: unknown[]) => counts());
const sendMock = vi.fn(async (..._args: unknown[]) => ({ reviews: [] }));
const subreposMock = vi.fn(async (repo: string): Promise<SubReposResponse> => ({
  repos: [{ id: "", name: repo.split("/").pop() ?? repo, root: repo, kind: "root" }],
}));
// The picker dialog always fetches a preview per candidate — default to a
// permanently-pending promise so tests that don't care about the preview
// (and never open the picker) aren't affected; tests that do open it set
// their own resolved/rejected value first.
const panePreviewMock = vi.fn(async (..._args: [string]) => new Promise(() => {}));

const { SendTargetError } = vi.hoisted(() => {
  class SendTargetErrorImpl extends Error {
    type: "no_agent" | "ambiguous_target" | "invalid_target";
    targets?: string[];
    constructor(type: "no_agent" | "ambiguous_target" | "invalid_target", targets?: string[]) {
      super(type);
      this.type = type;
      this.targets = targets;
    }
  }
  return { SendTargetError: SendTargetErrorImpl };
});

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
    subrepos: (...args: [string]) => subreposMock(...args),
  },
  reviewApi: {
    counts: (...args: unknown[]) => countsMock(...args),
    send: (...args: unknown[]) => sendMock(...args),
  },
  herdrApi: {
    panePreview: (...args: [string]) => panePreviewMock(...args),
  },
  SendTargetError,
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

  test("shows the worktree header, tabs (no Review tab), and pin toggle when a worktree is selected", () => {
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
    expect(screen.queryByRole("tab", { name: "Review" })).not.toBeInTheDocument();
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

  describe("review counts + send button", () => {
    test("passes reviewCounts fetched via reviewApi.counts down to GraphPanel", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 3 }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      selectTab("Graph");
      await waitFor(() =>
        expect(screen.getByTestId("graph-panel-stub")).toHaveTextContent(
          "graph:/Users/dev/project:3",
        ),
      );
    });

    test("send button shows pendingDrafts and is disabled at 0", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 0 }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      const button = await screen.findByRole("button", { name: "送信 (0)" });
      expect(button).toBeDisabled();
    });

    test("send button is enabled with a nonzero count and, with a single agent pane, POSTs /api/review/send with its pane id", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 2 }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [pane({ paneId: "claude-1" })])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
      await waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith({
          repo: "/Users/dev/project/.git",
          worktreeRoot: "/Users/dev/project",
          pane: "claude-1",
        }),
      );
    });

    test("disables the send button and shows a hint when the worktree has no agent pane", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 2 }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [pane({ agent: null })])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "この worktree にエージェントがいません");
    });

    test("with two agent panes, clicking send opens a picker; choosing the second pane sends with its id", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 1 }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [
            pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
            pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
          ])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      const button = await screen.findByRole("button", { name: "送信 (1)" });
      fireEvent.click(button);

      expect(await screen.findByText("送信先を選択")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /ws-2.*second/s }));

      await waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith({
          repo: "/Users/dev/project/.git",
          worktreeRoot: "/Users/dev/project",
          pane: "claude-2",
        }),
      );
    });

    test("renders one card per candidate with workspace/tab/title and the tail lines from a fetched preview", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 1 }));
      panePreviewMock.mockImplementation(async (paneId) => ({
        pane: paneId,
        workspaceLabel: `preview-ws-${paneId}`,
        tabLabel: `preview-tab-${paneId}`,
        title: `preview-title-${paneId}`,
        agent: "claude",
        agentStatus: "working",
        agentSession: "session-abcdef123456",
        layout: null,
        tail: ["doing thing A", "doing thing B"],
      }));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [
            pane({ paneId: "claude-1" }),
            pane({ paneId: "claude-2", agent: "codex" }),
          ])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "送信 (1)" }));
      expect(await screen.findByText("送信先を選択")).toBeInTheDocument();

      const card = await screen.findByRole("button", {
        name: /preview-ws-claude-1.*preview-tab-claude-1.*preview-title-claude-1/s,
      });
      expect(card).toHaveTextContent("doing thing A");
      expect(card).toHaveTextContent("doing thing B");
    });

    test("a failed preview fetch still leaves the card usable — clicking it sends to that pane", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 1 }));
      panePreviewMock.mockRejectedValue(new Error("boom"));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [
            pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
            pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
          ])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "送信 (1)" }));
      const card = await screen.findByRole("button", { name: /ws-1.*first/s });
      fireEvent.click(card);

      await waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith({
          repo: "/Users/dev/project/.git",
          worktreeRoot: "/Users/dev/project",
          pane: "claude-1",
        }),
      );
    });

    test("shows a readable message when the server answers 409 no_agent", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 2 }));
      sendMock.mockRejectedValueOnce(new SendTargetError("no_agent"));
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          repos={reposWithPanes("/Users/dev/project", [pane({ paneId: "claude-1" })])}
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      fireEvent.click(button);

      expect(await screen.findByText("この worktree にエージェントがいません")).toBeInTheDocument();
    });

    test("a review WS event for a different repo does not refetch review counts", async () => {
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
      await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(1));

      emit?.({
        type: "review",
        event: "created",
        review: {
          id: "r1",
          repo: "/other/.git",
          target: { kind: "worktree", root: "/other" },
          worktreeRoot: "/other",
          path: "a.txt",
          anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
          createdAtHead: "abc",
          viewedAs: { from: "HEAD", to: "WORKTREE" },
          status: "open",
          thread: [
            { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
          ],
          notify: { state: "pending", pane: null, at: null },
          createdAt: "t",
          updatedAt: "t",
        },
      });
      expect(countsMock).toHaveBeenCalledTimes(1);

      emit?.({
        type: "review",
        event: "created",
        review: {
          id: "r2",
          repo: "/Users/dev/project/.git",
          target: { kind: "worktree", root: "/Users/dev/project" },
          worktreeRoot: "/Users/dev/project",
          path: "a.txt",
          anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
          createdAtHead: "abc",
          viewedAs: { from: "HEAD", to: "WORKTREE" },
          status: "open",
          thread: [
            { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
          ],
          notify: { state: "pending", pane: null, at: null },
          createdAt: "t",
          updatedAt: "t",
        },
      });
      await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(2));
    });
  });

  describe("sub-repo switcher", () => {
    test("does not show the select when there's only one entry (the root)", async () => {
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );
      await waitFor(() => expect(subreposMock).toHaveBeenCalledWith("/Users/dev/project"));
      expect(
        screen.queryByRole("combobox", { name: "サブリポジトリを選択" }),
      ).not.toBeInTheDocument();
    });

    test("shows the select with >1 entries; switching updates the repo/repoKey passed to Diff/Graph panels, and the header path", async () => {
      subreposMock.mockResolvedValueOnce({
        repos: [
          { id: "", name: "project", root: "/Users/dev/project", kind: "root" as const },
          {
            id: "vendor/lib",
            name: "lib",
            root: "/Users/dev/project/vendor/lib",
            kind: "submodule" as const,
          },
        ],
      });
      render(
        <ToolPane
          worktreeRoot="/Users/dev/project"
          repoKey="/Users/dev/project/.git"
          pinned={false}
          onPinToggle={vi.fn()}
          repoChangedTick={0}
          onOpenPath={vi.fn()}
        />,
      );

      const trigger = await screen.findByRole("combobox", { name: "サブリポジトリを選択" });
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project:WORKTREE:HEAD",
      );

      fireEvent.click(trigger);
      const option = await screen.findByRole("option", { name: /lib/ });
      fireEvent.click(option);

      // repo passed to DiffPanel follows the selected sub-repo's root.
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project/vendor/lib:WORKTREE:HEAD",
        ),
      );
      // header path shows <worktree>/<subrepo>
      expect(screen.getByText("/Users/dev/project/vendor/lib")).toBeInTheDocument();

      selectTab("Graph");
      expect(screen.getByTestId("graph-panel-stub")).toHaveTextContent(
        "graph:/Users/dev/project/vendor/lib",
      );
    });

    test("resets the sub-repo selection back to the worktree root when worktreeRoot changes", async () => {
      subreposMock.mockResolvedValueOnce({
        repos: [
          { id: "", name: "project-a", root: "/Users/dev/project-a", kind: "root" as const },
          {
            id: "vendor/lib",
            name: "lib",
            root: "/Users/dev/project-a/vendor/lib",
            kind: "submodule" as const,
          },
        ],
      });
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
      const trigger = await screen.findByRole("combobox", { name: "サブリポジトリを選択" });
      fireEvent.click(trigger);
      const option = await screen.findByRole("option", { name: /lib/ });
      fireEvent.click(option);
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project-a/vendor/lib:WORKTREE:HEAD",
        ),
      );

      // subreposMock's default implementation (single root entry) applies
      // to project-b, since the queued mockResolvedValueOnce above was
      // already consumed by the mount above.
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
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project-b:WORKTREE:HEAD",
        ),
      );
      expect(
        screen.queryByRole("combobox", { name: "サブリポジトリを選択" }),
      ).not.toBeInTheDocument();
    });
  });
});
