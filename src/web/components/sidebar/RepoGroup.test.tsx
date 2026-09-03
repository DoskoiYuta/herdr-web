import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Repo } from "@contract/events";
import { RepoGroup } from "./RepoGroup";

const createWorkspace = vi.fn();

vi.mock("@/lib/api", () => ({
  herdrApi: {
    createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  },
}));

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    key: "/repo/.git",
    name: "repo",
    worktrees: [
      { root: "/repo", branch: "main", isMain: true, panes: [] },
      { root: "/repo-linked", branch: "feature", isMain: false, panes: [] },
    ],
    counts: { blocked: 0, done: 0 },
    ...overrides,
  };
}

function defaultProps() {
  return {
    repo: repo(),
    displayName: "repo",
    pinnedWorktreeRoot: null,
    focusedWorkspaceId: null,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onSelectPane: vi.fn(),
  };
}

beforeEach(() => {
  createWorkspace.mockReset();
  createWorkspace.mockResolvedValue({ workspaceId: "new-w" });
});

describe("RepoGroup create-workspace flow", () => {
  test("shows a create button that opens an inline form defaulting the label to the repo name", () => {
    render(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    expect(screen.getByLabelText("ワークスペース名")).toHaveValue("repo");
  });

  test("submitting the form calls createWorkspace with the main worktree's root as cwd, the label, and focus: true", async () => {
    render(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));

    const input = screen.getByLabelText("ワークスペース名");
    fireEvent.change(input, { target: { value: "my-ws" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await vi.waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({
        cwd: "/repo",
        label: "my-ws",
        focus: true,
      });
    });
  });

  test("shows an inline error when creation fails, and keeps the form open", async () => {
    createWorkspace.mockRejectedValueOnce(new Error("boom"));
    render(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByLabelText("ワークスペース名")).toBeInTheDocument();
  });

  test("cancel closes the form without calling the api", () => {
    render(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByLabelText("ワークスペース名")).not.toBeInTheDocument();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  test("clicking the create button does not toggle repo collapse", () => {
    const onToggleCollapse = vi.fn();
    render(<RepoGroup {...defaultProps()} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});
