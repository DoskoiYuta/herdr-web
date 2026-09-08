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
  // 近いか（他の質問が動いているか）を利用者が知る手段がなくなる。ワークスペース
  // 単位で重複排除しないと、1 つの ask ワークスペースが複数 pane に分かれた
  // ときに N が水増しされる（サーバーの liveAskWorkspaceCount との定義ずれ）。
  function worktreesFixture(groups: { root: string; panes: PaneRow[] }[]) {
    return groups.map((g) => ({ root: g.root, branch: "main", isMain: true, panes: g.panes }));
  }

  test.each<[string, { root: string; panes: PaneRow[] }[], number]>([
    [
      "distinct ask workspaces across worktrees count separately",
      [
        {
          root: "/wt-a",
          panes: [
            pane({ paneId: "claude-1", workspaceId: "w1", agent: "claude" }),
            pane({ paneId: "ask-1", workspaceId: "w2", agent: "claude", ask: true }),
          ],
        },
        {
          root: "/wt-b",
          panes: [pane({ paneId: "ask-2", workspaceId: "w3", agent: "claude", ask: true })],
        },
      ],
      2,
    ],
    [
      "two panes in the same ask workspace count as one",
      [
        {
          root: "/wt-a",
          panes: [
            pane({ paneId: "ask-1a", workspaceId: "w2", agent: "claude", ask: true }),
            pane({ paneId: "ask-1b", workspaceId: "w2", agent: "claude", ask: true }),
          ],
        },
      ],
      1,
    ],
  ])("%s", (_label, groups, expected) => {
    const repos: Repo[] = [repo({ worktrees: worktreesFixture(groups) })];

    expect(liveAskSessionCount(repos)).toBe(expected);
  });
});
