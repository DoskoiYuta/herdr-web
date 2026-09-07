import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { renderWithStore } from "@/testing/renderWithRouter";
import { RepoGroup } from "./RepoGroup";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: null,
    tabId: "t1",
    tabLabel: null,
    label: null,
    agent: "claude",
    agentStatus: "working",
    terminalTitleStripped: null,
    focused: false,
    cwd: "/repo",
    foregroundCwd: "/repo",
    ...overrides,
  };
}

const createWorkspace = vi.fn();
const listAsks = vi.fn();

vi.mock("@/lib/api", () => ({
  herdrApi: {
    createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  },
  askApi: {
    list: (...args: unknown[]) => listAsks(...args),
    resolve: vi.fn(),
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
    focusedWorkspaceId: null,
    focusedPaneId: null,
    focusedAgentSessionId: null,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onSelectPane: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenAskFile: vi.fn(),
  };
}

beforeEach(() => {
  createWorkspace.mockReset();
  createWorkspace.mockResolvedValue({ workspaceId: "new-w" });
  listAsks.mockReset();
  listAsks.mockResolvedValue([]);
});

describe("RepoGroup create-workspace flow", () => {
  test("shows a create button that opens an inline form defaulting the label to the repo name", () => {
    renderWithStore(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    expect(screen.getByLabelText("ワークスペース名")).toHaveValue("repo");
  });

  test("submitting the form calls createWorkspace with the main worktree's root as cwd, the label, and focus: true", async () => {
    renderWithStore(<RepoGroup {...defaultProps()} />);
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
    renderWithStore(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByLabelText("ワークスペース名")).toBeInTheDocument();
  });

  test("cancel closes the form without calling the api", () => {
    renderWithStore(<RepoGroup {...defaultProps()} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByLabelText("ワークスペース名")).not.toBeInTheDocument();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  test("clicking the create button does not toggle repo collapse", () => {
    const onToggleCollapse = vi.fn();
    renderWithStore(<RepoGroup {...defaultProps()} onToggleCollapse={onToggleCollapse} />);
    fireEvent.click(screen.getByTestId("create-workspace-/repo/.git"));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});

describe("RepoGroup ask-session rows", () => {
  test("keeps an ask: workspace out of the normal workspace rows and lists it as an ask-session row at the same level", () => {
    const withAsk = repo({
      worktrees: [
        {
          root: "/repo",
          branch: "main",
          isMain: true,
          panes: [
            pane({ paneId: "p1", workspaceId: "w1", workspaceLabel: "normal-ws" }),
            pane({
              paneId: "ask-p1",
              workspaceId: "w-ask",
              workspaceLabel: "ask:abc12345",
              ask: true,
            }),
          ],
        },
      ],
    });

    renderWithStore(<RepoGroup {...defaultProps()} repo={withAsk} />);

    expect(screen.getByTestId("workspace-row-w1")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-row-w-ask")).not.toBeInTheDocument();
    expect(screen.getByTestId("ask-session-row-w-ask")).toBeInTheDocument();
    expect(screen.getByText("ask:abc12345")).toBeInTheDocument();
  });

  test("shows no ask-session row when the repo has no ask workspaces", () => {
    renderWithStore(<RepoGroup {...defaultProps()} />);
    expect(screen.queryByTestId(/^ask-session-row-/)).not.toBeInTheDocument();
  });
});
