import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { Sidebar, type SidebarProps } from "./Sidebar";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
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
    pinnedWorktreeRoot: null,
    onSelectPane: vi.fn(),
    layout: { width: 240, collapsed: false },
    onLayoutChange: vi.fn(),
  };
}

describe("Sidebar", () => {
  test("renders repo header, worktree branch/marker, and pane row", () => {
    render(<Sidebar {...defaultProps()} />);
    expect(screen.getByText("repo")).toBeInTheDocument();
    expect(screen.getByText("main worktree")).toBeInTheDocument();
    expect(screen.getByText("claude: session")).toBeInTheDocument();
  });

  test("shows blocked/done badges with an icon (not just color), blocked most prominent", () => {
    const props = defaultProps();
    props.repos = [repo({ counts: { blocked: 2, done: 1 } })];
    render(<Sidebar {...props} />);
    const blockedBadge = screen.getByText("2").closest("span")!;
    expect(within(blockedBadge).getByText("2")).toBeInTheDocument();
    expect(blockedBadge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  test("clicking a pane row sends focus-pane via onSelectPane", () => {
    const props = defaultProps();
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByText("claude: session"));
    expect(props.onSelectPane).toHaveBeenCalledWith("p1");
  });

  test("the focused pane row is highlighted via aria-current", () => {
    const props = defaultProps();
    props.repos = [
      repo({
        worktrees: [
          { root: "/repo", branch: "main", isMain: true, panes: [pane({ focused: true })] },
        ],
      }),
    ];
    render(<Sidebar {...props} />);
    expect(screen.getByTestId("pane-row-p1")).toHaveAttribute("aria-current", "true");
  });

  test("the pinned worktree shows a pin marker", () => {
    const props = defaultProps();
    props.pinnedWorktreeRoot = "/repo";
    render(<Sidebar {...props} />);
    expect(screen.getByLabelText("ピン留め中")).toBeInTheDocument();
  });

  test("shows herdr 未接続 with connection state when not connected", () => {
    const props = defaultProps();
    props.herdrConnected = false;
    props.connection = "reconnecting";
    render(<Sidebar {...props} />);
    expect(screen.getByText("herdr 未接続（再接続中…）")).toBeInTheDocument();
  });

  test("collapsing a repo group hides its worktrees/panes", () => {
    render(<Sidebar {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("repo-header-/repo/.git"));
    expect(screen.queryByText("claude: session")).not.toBeInTheDocument();
  });

  test("switching to workspace mode reconstructs workspace > tab > pane from the same rows", () => {
    render(<Sidebar {...defaultProps()} />);
    fireEvent.click(screen.getByRole("radio", { name: "workspace 表示" }));
    expect(screen.getByText("workspace w1")).toBeInTheDocument();
    expect(screen.getByText("tab t1")).toBeInTheDocument();
    expect(screen.getByText("claude: session")).toBeInTheDocument();
  });

  test("collapsing the sidebar renders an icon rail and calls onLayoutChange to expand", () => {
    const props = defaultProps();
    props.layout = { width: 240, collapsed: true };
    props.repos = [repo({ counts: { blocked: 3, done: 0 } })];
    render(<Sidebar {...props} />);
    expect(screen.getByLabelText("サイドバー（折りたたみ）")).toBeInTheDocument();
    expect(screen.queryByText("claude: session")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("サイドバーを開く"));
    expect(props.onLayoutChange).toHaveBeenCalledWith({ width: 240, collapsed: false });
  });

  test("the collapse button persists collapsed=true via onLayoutChange", () => {
    const props = defaultProps();
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByLabelText("サイドバーを折りたたむ"));
    expect(props.onLayoutChange).toHaveBeenCalledWith({ width: 240, collapsed: true });
  });

  test("is resizable via the ResizeHandle separator", () => {
    render(<Sidebar {...defaultProps()} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
