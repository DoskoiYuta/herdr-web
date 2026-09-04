import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { agentPanesAt } from "./sendTargets";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: null,
    tabId: "t1",
    tabLabel: null,
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

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    key: "/repo/.git",
    name: "repo",
    worktrees: [],
    counts: { blocked: 0, done: 0 },
    ...overrides,
  };
}

describe("agentPanesAt", () => {
  test("returns only agent panes under the worktree matching root, focused pane first", () => {
    const repos: Repo[] = [
      repo({
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "shell", agent: null }),
              pane({ paneId: "claude-1", agent: "claude", focused: false }),
              pane({ paneId: "claude-2", agent: "claude", focused: true }),
            ],
          },
          {
            root: "/wt-b",
            branch: "other",
            isMain: false,
            panes: [pane({ paneId: "codex-1", agent: "codex" })],
          },
        ],
      }),
    ];

    const result = agentPanesAt(repos, "/wt-a");

    expect(result.map((p) => p.paneId)).toEqual(["claude-2", "claude-1"]);
  });

  test("returns an empty list when the worktree root has no match", () => {
    expect(agentPanesAt([], "/missing")).toEqual([]);
  });
});
