import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { groupByWorkspace } from "./repoWorkspaces";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: null,
    tabLabel: null,
    tabId: "t1",
    label: null,
    agent: null,
    agentStatus: "idle",
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
    counts: { blocked: 0, done: 0 },
    worktrees: [],
    ...overrides,
  };
}

describe("groupByWorkspace", () => {
  test("groups panes sharing a workspaceId across multiple worktrees, preserving worktree/pane order", () => {
    const r = repo({
      worktrees: [
        {
          root: "/repo",
          branch: "main",
          isMain: true,
          panes: [
            pane({ paneId: "p1", workspaceId: "w1" }),
            pane({ paneId: "p2", workspaceId: "w2" }),
          ],
        },
        {
          root: "/repo-linked",
          branch: "feature",
          isMain: false,
          panes: [pane({ paneId: "p3", workspaceId: "w1" })],
        },
      ],
    });

    const groups = groupByWorkspace(r);

    expect(groups.map((g) => g.workspaceId)).toEqual(["w1", "w2"]);
    expect(groups[0]!.panes.map((p) => p.paneId)).toEqual(["p1", "p3"]);
    expect(groups[1]!.panes.map((p) => p.paneId)).toEqual(["p2"]);
  });

  test("a workspace whose panes span the main worktree and a linked worktree annotates each pane with its own worktree's branch/isMain/root", () => {
    const r = repo({
      worktrees: [
        {
          root: "/repo",
          branch: "main",
          isMain: true,
          panes: [pane({ paneId: "p1", workspaceId: "w1" })],
        },
        {
          root: "/repo-linked",
          branch: "feature",
          isMain: false,
          panes: [pane({ paneId: "p2", workspaceId: "w1" })],
        },
      ],
    });

    const groups = groupByWorkspace(r);

    expect(groups).toHaveLength(1);
    const [p1, p2] = groups[0]!.panes;
    expect(p1).toMatchObject({ paneId: "p1", branch: "main", isMain: true, worktreeRoot: "/repo" });
    expect(p2).toMatchObject({
      paneId: "p2",
      branch: "feature",
      isMain: false,
      worktreeRoot: "/repo-linked",
    });
  });

  test("a repo with no worktrees produces no workspace groups", () => {
    expect(groupByWorkspace(repo({ worktrees: [] }))).toEqual([]);
  });
});
