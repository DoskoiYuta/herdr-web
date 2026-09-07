import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FocusMessage } from "@contract/events";
import type { SubReposResponse } from "@contract/git";
import type { PaneRow, Repo } from "@contract/events";
import type { ReviewCountsResponse } from "@contract/review";
import { makeFakeStore, renderWithRouter } from "@/testing/renderWithRouter";
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

function focusMessage(overrides: Partial<FocusMessage> = {}): FocusMessage {
  return {
    type: "focus",
    pane: "p1",
    workspace: "w1",
    cwd: "/repo",
    foregroundCwd: "/repo",
    worktreeRoot: "/Users/dev/project",
    repoKey: null,
    agent: null,
    agentStatus: null,
    agentSession: null,
    ...overrides,
  };
}

/** worktreeRoot に追従する `/focus/diff` を、その worktree/repoKey/repos で
 * フォーカス中として描画する（旧テストの `worktreeRoot`/`repoKey`/`repos` prop
 * に相当）。 */
async function renderFocused(
  opts: {
    worktreeRoot?: string | null;
    repoKey?: string | null;
    repos?: Repo[];
    focusOverrides?: Partial<FocusMessage>;
  } = {},
) {
  const { worktreeRoot = "/Users/dev/project", repoKey = null, repos = [], focusOverrides } = opts;
  const store = makeFakeStore({
    repos,
    focus:
      worktreeRoot === null ? null : focusMessage({ worktreeRoot, repoKey, ...focusOverrides }),
  });
  return { ...(await renderWithRouter(() => <ToolPane />, { path: "/focus/diff", store })), store };
}

// Radix `Tabs.Trigger` activates on `mousedown`, not `click` (see
// @radix-ui/react-tabs) — `fireEvent.click` alone never dispatches a
// `mousedown`, so switching tabs in jsdom needs this helper. Tab switches
// navigate the router (async), so wait for the trigger to actually become
// the active tab before returning.
async function selectTab(name: string) {
  const trigger = screen.getByRole("tab", { name });
  fireEvent.mouseDown(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "active"));
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

vi.mock("@/components/files/FilesPanel", () => ({
  FilesPanel: ({
    repo,
    initialLocation,
    onInitialLocationConsumed,
  }: {
    repo: string;
    initialLocation?: { path: string; line: number } | null;
    onInitialLocationConsumed?: () => void;
  }) => (
    <div data-testid="files-panel-stub">
      {repo}
      {initialLocation && (
        <>
          <span data-testid="files-panel-initial-location">
            {initialLocation.path}:{initialLocation.line}
          </span>
          <button type="button" onClick={onInitialLocationConsumed}>
            consume
          </button>
        </>
      )}
    </div>
  ),
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

  // 無いと壊れる: focus 追従中に worktree が切り替わっても DiffPanel が使い回され、
  // 前の worktree の annotation/選択が残る。
  test("remounts DiffPanel (fresh instance) when worktreeRoot changes, but not for a repoChangedTick bump alone", async () => {
    const repoKey = "/Users/dev/project-a/.git";
    const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a", repoKey });
    expect(diffPanelMountCount).toBe(1);

    store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b", repoKey }) });
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project-b:WORKTREE:HEAD",
      ),
    );
    expect(diffPanelMountCount).toBe(2);

    countsMock.mockClear();
    store.setState({ repoChanged: { "/Users/dev/project-b": { head: "h", tick: 1 } } });
    await waitFor(() => expect(countsMock).toHaveBeenCalled());
    expect(diffPanelMountCount).toBe(2);
  });

  test("shows only the herdr 未接続 message when no worktree is selected (F2-3)", async () => {
    await renderFocused({ worktreeRoot: null });
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.queryByLabelText("リポジトリのパスを開く")).not.toBeInTheDocument();
  });

  test("shows the worktree header and tabs (no Review tab) when a worktree is selected", async () => {
    await renderFocused();
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("/Users/dev/project")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Graph" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:WORKTREE:HEAD",
    );
  });

  test("switching to the Files tab renders FilesPanel with the current repo", async () => {
    await renderFocused();
    await selectTab("Files");
    expect(screen.getByTestId("files-panel-stub")).toHaveTextContent("/Users/dev/project");
  });

  test("navigating straight to the files tab with path/line passes the location down to FilesPanel, and consuming it drops line only", async () => {
    const store = makeFakeStore({ focus: focusMessage() });
    const { router } = await renderWithRouter(() => <ToolPane />, {
      path: "/focus/files?path=src%2Fa.ts&line=42",
      store,
    });
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("files-panel-initial-location")).toHaveTextContent("src/a.ts:42");

    // Drive ToolPane's real onInitialLocationConsumed wiring via the stub's
    // consume button, rather than calling router.navigate directly.
    fireEvent.click(screen.getByRole("button", { name: "consume" }));
    await waitFor(() =>
      expect(screen.queryByTestId("files-panel-initial-location")).not.toBeInTheDocument(),
    );
    expect(router.state.location.search).not.toHaveProperty("line");
    expect(router.state.location.search).toMatchObject({ path: "src/a.ts" });
  });

  test("selecting a commit in the graph tab sets the diff comparison and shows a reset button", async () => {
    await renderFocused();
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    await selectTab("Diff");

    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:aaa111:bbb222",
    );
    const resetButton = screen.getByRole("button", { name: "作業ツリーに戻る" });
    fireEvent.click(resetButton);
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project:WORKTREE:HEAD",
      ),
    );
  });

  test("shows the focused pane's agent/status and offers a claude --resume copy button", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await renderFocused({
      focusOverrides: {
        agent: "claude",
        agentStatus: "working",
        agentSession: { source: "herdr:claude", agent: "claude", kind: "id", value: "abc-123" },
      },
    });
    expect(screen.getByText("claude · working")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "claude --resume abc-123" });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("claude --resume abc-123");
  });

  test("does not show a resume button for a non-claude agent session", async () => {
    await renderFocused({
      focusOverrides: {
        agent: "codex",
        agentStatus: "idle",
        agentSession: { source: "herdr:codex", agent: "codex", kind: "path", value: "/tmp/x" },
      },
    });
    expect(screen.getByText("codex · idle")).toBeInTheDocument();
    expect(screen.queryByText(/claude --resume/)).not.toBeInTheDocument();
  });

  // 無いと壊れる: focus 追従中に worktree が切り替わったのに前の比較範囲が
  // 残ると、新しい worktree に存在しないハッシュで diff を取りに行ってしまう。
  test("switching worktreeRoot resets a picked commit comparison back to the working tree", async () => {
    const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a" });
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    await selectTab("Diff");
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project-a:aaa111:bbb222",
    );

    store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b" }) });
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project-b:WORKTREE:HEAD",
      ),
    );
  });

  describe("review counts + send button", () => {
    test("passes reviewCounts fetched via reviewApi.counts down to GraphPanel", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 3 }));
      await renderFocused({ repoKey: "/Users/dev/project/.git" });
      await selectTab("Graph");
      await waitFor(() =>
        expect(screen.getByTestId("graph-panel-stub")).toHaveTextContent(
          "graph:/Users/dev/project:3",
        ),
      );
    });

    test("send button shows pendingDrafts and is disabled at 0", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 0 }));
      await renderFocused({ repoKey: "/Users/dev/project/.git" });
      const button = await screen.findByRole("button", { name: "送信 (0)" });
      expect(button).toBeDisabled();
    });

    test("send button is enabled with a nonzero count and, with a single agent pane, POSTs /api/review/send with its pane id", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 2 }));
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [pane({ paneId: "claude-1" })]),
      });
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
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [pane({ agent: null })]),
      });
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "この worktree にエージェントがいません");
    });

    test("with two agent panes, clicking send opens a picker; choosing the second pane sends with its id", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 1 }));
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [
          pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
          pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
        ]),
      });
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
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [
          pane({ paneId: "claude-1" }),
          pane({ paneId: "claude-2", agent: "codex" }),
        ]),
      });
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
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [
          pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
          pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
        ]),
      });
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
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [pane({ paneId: "claude-1" })]),
      });
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      fireEvent.click(button);

      expect(await screen.findByText("この worktree にエージェントがいません")).toBeInTheDocument();
    });

    test("a review WS event for a different repo does not refetch review counts", async () => {
      const { store } = await renderFocused({ repoKey: "/Users/dev/project/.git" });
      await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(1));

      store.emitReview({
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

      store.emitReview({
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
      await renderFocused();
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
      await renderFocused({ repoKey: "/Users/dev/project/.git" });

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

      await selectTab("Graph");
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
      const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a" });
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
      store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b" }) });
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
