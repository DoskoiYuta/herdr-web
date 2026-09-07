import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { RepoWorkspaceRow } from "./RepoWorkspaceRow";

const renameWorkspace = vi.fn();
const closeWorkspace = vi.fn();

vi.mock("@/lib/api", () => ({
  herdrApi: {
    renameWorkspace: (...args: unknown[]) => renameWorkspace(...args),
    closeWorkspace: (...args: unknown[]) => closeWorkspace(...args),
  },
}));

function workspace(overrides: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return {
    workspaceId: "w1",
    workspaceLabel: "my-workspace",
    panes: [
      {
        paneId: "p1",
        workspaceId: "w1",
        workspaceLabel: "my-workspace",
        tabId: "t1",
        tabLabel: null,
        label: null,
        agent: "claude",
        agentStatus: "working",
        terminalTitleStripped: null,
        focused: false,
        cwd: "/repo",
        foregroundCwd: "/repo",
        branch: "main",
        isMain: true,
        worktreeRoot: "/repo",
      },
    ],
    ...overrides,
  };
}

function defaultProps() {
  return {
    workspace: workspace(),
    focusedWorkspaceId: null as string | null,
    focusedPaneId: null as string | null,
    focusedAgentSessionId: null as string | null,
    onSelectPane: vi.fn(),
    onOpenDiff: vi.fn(),
  };
}

beforeEach(() => {
  renameWorkspace.mockReset();
  closeWorkspace.mockReset();
  renameWorkspace.mockResolvedValue({ workspace: { workspace_id: "w1", label: "renamed" } });
  closeWorkspace.mockResolvedValue({ ok: true });
});

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("workspace-row-w1"));
}

describe("RepoWorkspaceRow expand/collapse", () => {
  test("is expanded by default when it is the focused workspace, showing its pane rows", () => {
    render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId="w1" />);
    expect(screen.getByTestId("pane-row-p1")).toBeInTheDocument();
  });

  test("is collapsed by default when it is not the focused workspace", () => {
    render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId={null} />);
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
  });

  test("clicking the chevron toggles the pane list independently of the row's focus click", () => {
    render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId={null} />);
    fireEvent.click(screen.getByLabelText("展開する"));
    expect(screen.getByTestId("pane-row-p1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("折りたたむ"));
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
  });

  // 無いと壊れる: フォーカスがこの workspace に移っても畳まれたままになり、
  // 「フォーカス中 workspace は展開されている」という前提が破れる。
  test("expands automatically the moment focus moves onto it (not just on mount)", () => {
    const { rerender } = render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId={null} />);
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
    rerender(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId="w1" />);
    expect(screen.getByTestId("pane-row-p1")).toBeInTheDocument();
  });

  // 無いと壊れる: 手で畳んだ行が、フォーカスが他所へ移った拍子に勝手に開き
  // 直してしまう（ユーザー操作より自動展開が優先されてしまう）。
  test("stays collapsed after the user manually collapses it, even once focus moves elsewhere", () => {
    const { rerender } = render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId="w1" />);
    expect(screen.getByTestId("pane-row-p1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("折りたたむ"));
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
    rerender(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId="w2" />);
    expect(screen.queryByTestId("pane-row-p1")).not.toBeInTheDocument();
  });
});

describe("RepoWorkspaceRow focus accent", () => {
  test("marks the row aria-current when it is the focused workspace", () => {
    render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId="w1" />);
    expect(screen.getByTestId("workspace-row-w1")).toHaveAttribute("aria-current", "true");
  });

  test("does not mark the row aria-current otherwise", () => {
    render(<RepoWorkspaceRow {...defaultProps()} focusedWorkspaceId={null} />);
    expect(screen.getByTestId("workspace-row-w1")).not.toHaveAttribute("aria-current");
  });

  test("passes focusedPaneId down so the matching pane row (not workspace.panes[].focused) is accented", () => {
    render(
      <RepoWorkspaceRow
        {...defaultProps()}
        focusedWorkspaceId="w1"
        focusedPaneId="p1"
        focusedAgentSessionId="sess-1"
      />,
    );
    expect(screen.getByTestId("pane-row-p1")).toHaveAttribute("aria-current", "true");
  });
});

describe("RepoWorkspaceRow row content", () => {
  test("shows a branch badge for a non-main branch among its panes", () => {
    render(
      <RepoWorkspaceRow
        {...defaultProps()}
        workspace={workspace({
          panes: [
            {
              ...workspace().panes[0]!,
              branch: "feature",
              isMain: false,
            },
          ],
        })}
      />,
    );
    expect(within(screen.getByTestId("workspace-row-w1")).getByText("feature")).toBeInTheDocument();
  });

  test("omits the branch badge for the main branch", () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    expect(
      within(screen.getByTestId("workspace-row-w1")).queryByText("main"),
    ).not.toBeInTheDocument();
  });

  test("shows an aggregated status count and agent count, omitting zero counts", () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    const row = screen.getByTestId("workspace-row-w1");
    expect(within(row).queryByLabelText("状態: blocked")).not.toBeInTheDocument();
    expect(within(row).queryByLabelText("状態: done")).not.toBeInTheDocument();
    expect(within(row).getByLabelText("状態: working").closest("span")).toHaveTextContent("1");
    expect(within(row).getByLabelText("agent 数").closest("span")).toHaveTextContent("1");
  });
});

describe("RepoWorkspaceRow context menu", () => {
  test("right-click opens a menu with フォーカスを移す, 名前を変更, Diff を開く and 削除", () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    openMenu();
    expect(screen.getByText("フォーカスを移す")).toBeInTheDocument();
    expect(screen.getByText("名前を変更")).toBeInTheDocument();
    expect(screen.getByText("Diff を開く")).toBeInTheDocument();
    expect(screen.getByText("削除")).toBeInTheDocument();
  });

  test("Diff を開く focuses the target pane and calls onOpenDiff with it", () => {
    const props = defaultProps();
    render(<RepoWorkspaceRow {...props} />);
    openMenu();
    fireEvent.click(screen.getByText("Diff を開く"));
    expect(props.onOpenDiff).toHaveBeenCalledWith("p1");
  });

  test("フォーカスを移す in the menu calls onSelectPane with the focused pane, else the first", () => {
    const props = defaultProps();
    render(<RepoWorkspaceRow {...props} />);
    openMenu();
    fireEvent.click(screen.getByText("フォーカスを移す"));
    expect(props.onSelectPane).toHaveBeenCalledWith("p1");
  });

  test("名前を変更 opens a dialog prefilled with the current label; submitting calls renameWorkspace", async () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    openMenu();
    fireEvent.click(screen.getByText("名前を変更"));

    const input = screen.getByLabelText("ワークスペース名");
    expect(input).toHaveValue("my-workspace");
    fireEvent.change(input, { target: { value: "new-name" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await vi.waitFor(() => {
      expect(renameWorkspace).toHaveBeenCalledWith("w1", "new-name");
    });
  });

  test("削除 opens a confirm dialog naming the workspace; confirming calls closeWorkspace with confirm: true", async () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    openMenu();
    fireEvent.click(screen.getByText("削除"));

    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("my-workspace");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    await vi.waitFor(() => {
      expect(closeWorkspace).toHaveBeenCalledWith("w1", { confirm: true });
    });
  });

  test("canceling the delete dialog (closing it) does not call closeWorkspace", async () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    openMenu();
    fireEvent.click(screen.getByText("削除"));
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("my-workspace");

    fireEvent.keyDown(heading, { key: "Escape", code: "Escape" });

    expect(closeWorkspace).not.toHaveBeenCalled();
  });

  test("left click still focuses the workspace (unchanged behavior)", () => {
    const onSelectPane = vi.fn();
    render(<RepoWorkspaceRow {...defaultProps()} onSelectPane={onSelectPane} />);
    fireEvent.click(screen.getByTestId("workspace-row-w1"));
    expect(onSelectPane).toHaveBeenCalledWith("p1");
  });
});
