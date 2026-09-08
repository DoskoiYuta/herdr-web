import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { agentPanesAt, liveAskSessionCount } from "./sendTargets";

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

  test("excludes ask-session panes — a review must not be sendable to a question session", () => {
    const repos: Repo[] = [
      repo({
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "claude-1", agent: "claude" }),
              pane({ paneId: "ask-1", agent: "claude", ask: true }),
            ],
          },
        ],
      }),
    ];

    expect(agentPanesAt(repos, "/wt-a").map((p) => p.paneId)).toEqual(["claude-1"]);
  });
});

describe("liveAskSessionCount", () => {
  // 無いと壊れる: 送信先ダイアログの「同時 N/M」が常に N=0 になり、上限にどれだけ
  // 近いか（他の質問が動いているか）を利用者が知る手段がなくなる。
  test("counts ask-session panes across every worktree, not just the current one", () => {
    const repos: Repo[] = [
      repo({
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "claude-1", agent: "claude" }),
              pane({ paneId: "ask-1", agent: "claude", ask: true }),
            ],
          },
          {
            root: "/wt-b",
            branch: "other",
            isMain: false,
            panes: [pane({ paneId: "ask-2", agent: "claude", ask: true })],
          },
        ],
      }),
    ];

    expect(liveAskSessionCount(repos)).toBe(2);
  });
});
