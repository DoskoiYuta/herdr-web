import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { buildWorkspaceView } from "./workspaceView";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
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

describe("buildWorkspaceView", () => {
  test("groups panes across repos/worktrees by workspaceId then tabId, sorted", () => {
    const repos: Repo[] = [
      {
        key: "a",
        name: "a",
        counts: { blocked: 0, done: 0 },
        worktrees: [
          {
            root: "/a",
            branch: "main",
            isMain: true,
            panes: [pane({ paneId: "p1", workspaceId: "w2", tabId: "t1" })],
          },
        ],
      },
      {
        key: "b",
        name: "b",
        counts: { blocked: 0, done: 0 },
        worktrees: [
          {
            root: "/b",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "p2", workspaceId: "w1", tabId: "t2" }),
              pane({ paneId: "p3", workspaceId: "w1", tabId: "t1" }),
            ],
          },
        ],
      },
    ];

    const view = buildWorkspaceView(repos);
    expect(view.map((w) => w.workspaceId)).toEqual(["w1", "w2"]);
    expect(view[0]!.tabs.map((t) => t.tabId)).toEqual(["t1", "t2"]);
    expect(view[0]!.tabs[0]!.panes.map((p) => p.paneId)).toEqual(["p3"]);
    expect(view[0]!.tabs[1]!.panes.map((p) => p.paneId)).toEqual(["p2"]);
    expect(view[1]!.tabs[0]!.panes.map((p) => p.paneId)).toEqual(["p1"]);
  });

  test("empty repos produce an empty view", () => {
    expect(buildWorkspaceView([])).toEqual([]);
  });
});
