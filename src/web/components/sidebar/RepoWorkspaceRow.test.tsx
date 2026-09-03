import { fireEvent, render, screen } from "@testing-library/react";
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
    pinnedWorktreeRoot: null,
    focusedWorkspaceId: null,
    onSelectPane: vi.fn(),
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

describe("RepoWorkspaceRow context menu", () => {
  test("right-click opens a menu with 名前を変更 and 削除", () => {
    render(<RepoWorkspaceRow {...defaultProps()} />);
    openMenu();
    expect(screen.getByText("名前を変更")).toBeInTheDocument();
    expect(screen.getByText("削除")).toBeInTheDocument();
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
