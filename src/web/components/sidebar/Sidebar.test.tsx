import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { renderWithStore } from "@/testing/renderWithRouter";
import { Sidebar, type SidebarProps } from "./Sidebar";

const listAsks = vi.fn();

vi.mock("@/lib/api", () => ({
  askApi: {
    list: (...args: unknown[]) => listAsks(...args),
    resolve: vi.fn(),
  },
}));

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    workspaceLabel: null,
    tabLabel: null,
    paneId: "p1",
    workspaceId: "w1",
    tabId: "t1",
    label: "session",
    agent: "claude",
    agentStatus: "working",
    terminalTitleStripped: null,
    focused: false,
    cwd: "/repo",
    foregroundCwd: "/repo",
    ...overrides,
  };
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    key: "/repo/.git",
    name: "repo",
    worktrees: [{ root: "/repo", branch: "main", isMain: true, panes: [pane()] }],
    counts: { blocked: 0, done: 0 },
    ...overrides,
  };
}

function defaultProps(): SidebarProps {
  return {
    repos: [repo()],
    herdrConnected: true,
    connection: "open",
    protocol: 20,
    focusedWorkspaceId: null,
    focusedPaneId: null,
    focusedAgentSessionId: null,
    onSelectPane: vi.fn(),
    layout: { width: 240, collapsed: false },
    onLayoutChange: vi.fn(),
    onOpenAskFile: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenInbox: vi.fn(),
  };
}

beforeEach(() => {
  listAsks.mockReset();
  listAsks.mockResolvedValue([]);
});

describe("Sidebar", () => {
  test("renders repo header and a workspace row (leaf when not focused, no expanded pane rows)", () => {
    renderWithStore(<Sidebar {...defaultProps()} />);
    expect(screen.getByText("repo")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-row-w1")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
  });

  test("workspace row shows an aggregated status count (working) and agent count, omitting zero counts", () => {
    renderWithStore(<Sidebar {...defaultProps()} />);
    const row = screen.getByTestId("workspace-row-w1");
    expect(within(row).queryByLabelText("状態: blocked")).not.toBeInTheDocument();
    expect(within(row).queryByLabelText("状態: done")).not.toBeInTheDocument();
    expect(within(row).getByLabelText("状態: working").closest("span")).toHaveTextContent("1");
    expect(within(row).getByLabelText("agent 数").closest("span")).toHaveTextContent("1");
  });

  test("shows blocked/done counts on the repo header with an icon (not just color), blocked most prominent", () => {
    const props = defaultProps();
    props.repos = [repo({ counts: { blocked: 2, done: 1 } })];
    renderWithStore(<Sidebar {...props} />);
    const header = screen.getByTestId("repo-header-/repo/.git");
    const blockedBadge = within(header).getByLabelText("状態: blocked").closest("span")!;
    expect(within(blockedBadge).getByText("2")).toBeInTheDocument();
    expect(blockedBadge.querySelector("svg")).not.toBeNull();
    expect(within(header).getByText("1")).toBeInTheDocument();
  });

  test("clicking a workspace row focuses its focused pane if any, else its first pane", () => {
    const props = defaultProps();
    renderWithStore(<Sidebar {...props} />);
    fireEvent.click(screen.getByTestId("workspace-row-w1"));
    expect(props.onSelectPane).toHaveBeenCalledWith("p1");
  });

  test("clicking a workspace row with a focused pane sends that pane, not the first one", () => {
    const props = defaultProps();
    props.repos = [
      repo({
        worktrees: [
          {
            root: "/repo",
            branch: "main",
            isMain: true,
            panes: [pane({ paneId: "p1", focused: false }), pane({ paneId: "p2", focused: true })],
          },
        ],
      }),
    ];
    renderWithStore(<Sidebar {...props} />);
    fireEvent.click(screen.getByTestId("workspace-row-w1"));
    expect(props.onSelectPane).toHaveBeenCalledWith("p2");
  });

  test("the workspace row of the focused workspace is highlighted via aria-current", () => {
    const props = defaultProps();
    props.focusedWorkspaceId = "w1";
    renderWithStore(<Sidebar {...props} />);
    expect(screen.getByTestId("workspace-row-w1")).toHaveAttribute("aria-current", "true");
    cleanup();
    // pane.focused だけでは選択状態にならない（workspace ごとのアクティブ pane に過ぎない）
    const other = defaultProps();
    other.focusedWorkspaceId = null;
    other.repos = [
      repo({
        worktrees: [
          { root: "/repo", branch: "main", isMain: true, panes: [pane({ focused: true })] },
        ],
      }),
    ];
    renderWithStore(<Sidebar {...other} />);
    expect(screen.getByTestId("workspace-row-w1")).not.toHaveAttribute("aria-current");
  });

  test("expanding the focused workspace shows a pane row accented via focusedPaneId (not pane.focused)", () => {
    const props = defaultProps();
    props.focusedWorkspaceId = "w1";
    props.focusedPaneId = "p1";
    renderWithStore(<Sidebar {...props} />);
    expect(screen.getByTestId("pane-row-p1")).toHaveAttribute("aria-current", "true");
  });

  test("shows a branch badge only for panes in a non-main worktree, omitting it for main", () => {
    const props = defaultProps();
    props.repos = [
      repo({
        worktrees: [
          { root: "/repo", branch: "main", isMain: true, panes: [pane({ paneId: "p1" })] },
          {
            root: "/repo-linked",
            branch: "feature",
            isMain: false,
            panes: [pane({ paneId: "p2", workspaceId: "w1" })],
          },
        ],
      }),
    ];
    renderWithStore(<Sidebar {...props} />);
    const row = screen.getByTestId("workspace-row-w1");
    expect(within(row).getByText("feature")).toBeInTheDocument();
    expect(within(row).queryByText("main")).not.toBeInTheDocument();
  });

  test("shows an Inbox item; clicking it calls onOpenInbox", () => {
    const props = defaultProps();
    renderWithStore(<Sidebar {...props} />);
    fireEvent.click(screen.getByTestId("inbox-item"));
    expect(props.onOpenInbox).toHaveBeenCalled();
  });

  test("shows an empty state (not the tree) when herdr is not connected", () => {
    const props = defaultProps();
    props.herdrConnected = false;
    props.connection = "reconnecting";
    renderWithStore(<Sidebar {...props} />);
    expect(screen.getByText("herdr 未接続（再接続中…）")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-row-w1")).not.toBeInTheDocument();
  });

  test.each([
    ["connected", true, 20, "herdr 接続済み · protocol 20"],
    ["disconnected", false, null, "herdr 未接続 · 再接続中…"],
  ])("footer shows connection state (%s)", (_label, connected, protocol, expected) => {
    const props = defaultProps();
    props.herdrConnected = connected;
    props.connection = connected ? "open" : "reconnecting";
    props.protocol = protocol;
    renderWithStore(<Sidebar {...props} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test("collapsing a repo group hides its workspace rows", () => {
    renderWithStore(<Sidebar {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("repo-header-/repo/.git"));
    expect(screen.queryByTestId("workspace-row-w1")).not.toBeInTheDocument();
  });

  test("collapsing the sidebar renders an icon rail and calls onLayoutChange to expand", () => {
    const props = defaultProps();
    props.layout = { width: 240, collapsed: true };
    props.repos = [repo({ counts: { blocked: 3, done: 0 } })];
    renderWithStore(<Sidebar {...props} />);
    expect(screen.getByLabelText("サイドバー（折りたたみ）")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-row-w1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("サイドバーを開く"));
    expect(props.onLayoutChange).toHaveBeenCalledWith({ width: 240, collapsed: false });
  });

  test("the collapse button persists collapsed=true via onLayoutChange", () => {
    const props = defaultProps();
    renderWithStore(<Sidebar {...props} />);
    fireEvent.click(screen.getByLabelText("サイドバーを折りたたむ"));
    expect(props.onLayoutChange).toHaveBeenCalledWith({ width: 240, collapsed: true });
  });

  test("is resizable via the ResizeHandle separator", () => {
    renderWithStore(<Sidebar {...defaultProps()} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
