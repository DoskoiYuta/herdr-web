import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { liveAskSessionCount, sendTargetsFor } from "./sendTargets";

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

describe("sendTargetsFor", () => {
  // 無いと壊れる: pane.effectiveRoot（サブリポジトリ選択中はそのもの）を見ず
  // 物理 worktree.root だけで絞ると、そのサブリポジトリを選んでいない別
  // worktree の pane を候補に出す/出さないが、サーバーの通知宛先探索
  // （herdr-notifier.ts）とずれる。
  test("matches on pane.effectiveRoot when set, not the pane's own worktree root", () => {
    const repos: Repo[] = [
      repo({
        key: "/repo/.git",
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "claude-1", agent: "claude", effectiveRoot: "/wt-a/vendor/lib" }),
              pane({ paneId: "claude-2", agent: "claude" }),
            ],
          },
        ],
      }),
    ];

    expect(sendTargetsFor(repos, "/wt-a/vendor/lib", "/repo/.git").map((p) => p.paneId)).toEqual([
      "claude-1",
    ]);
  });

  // 無いと壊れる: サブリポジトリのレビュー送信先が、サーバーが実際に通知する
  // pane（別ワークスペースでそのサブリポジトリを選択中の pane）と一致しない
  // — 物理的な worktree 行だけを見ると 0 件（no_target）になってしまう。
  test("a pane in another workspace with the sub-repo selected is offered as the only candidate", () => {
    const repos: Repo[] = [
      repo({
        key: "/repo/.git",
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [pane({ paneId: "shell", agent: null })],
          },
          {
            root: "/wt-b",
            branch: "other",
            isMain: false,
            panes: [
              pane({
                paneId: "claude-in-wt-b",
                workspaceId: "w-other",
                agent: "claude",
                effectiveRoot: "/wt-a/vendor/lib",
                effectiveRepoKey: "/wt-a/vendor/lib/.git",
              }),
            ],
          },
        ],
      }),
    ];

    expect(
      sendTargetsFor(repos, "/wt-a/vendor/lib", "/wt-a/vendor/lib/.git").map((p) => p.paneId),
    ).toEqual(["claude-in-wt-b"]);
  });

  // 無いと壊れる: 選択中 root にエージェントが 1 人もいないとき、送信先
  // ダイアログが常に「対象なし」になり、他 worktree のエージェントに送る
  // 手段が無くなる。
  test("falls back to any pane whose effective repo matches when the root has no agent panes", () => {
    const repos: Repo[] = [
      repo({
        key: "/repo/.git",
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [pane({ paneId: "shell", agent: null })],
          },
          {
            root: "/wt-b",
            branch: "other",
            isMain: false,
            panes: [pane({ paneId: "claude-1", agent: "claude" })],
          },
        ],
      }),
    ];

    expect(sendTargetsFor(repos, "/wt-a", "/repo/.git").map((p) => p.paneId)).toEqual(["claude-1"]);
  });

  test("uses the root's own agent panes when it has any, without falling back", () => {
    const repos: Repo[] = [
      repo({
        key: "/repo/.git",
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [pane({ paneId: "claude-1", agent: "claude" })],
          },
          {
            root: "/wt-b",
            branch: "other",
            isMain: false,
            panes: [pane({ paneId: "claude-2", agent: "claude" })],
          },
        ],
      }),
    ];

    expect(sendTargetsFor(repos, "/wt-a", "/repo/.git").map((p) => p.paneId)).toEqual(["claude-1"]);
  });

  test("returns an empty list when nothing matches", () => {
    expect(sendTargetsFor([], "/missing", "/missing/.git")).toEqual([]);
  });

  // 無いと壊れる: agentPanesAt 時代からの契約（フォーカス優先・質問セッション
  // 除外）が sendTargetsFor 単体の関数にまとまった後も崩れていないことを保証
  // する唯一のテスト。
  test("orders the focused pane first and excludes ask-session panes", () => {
    const repos: Repo[] = [
      repo({
        key: "/repo/.git",
        worktrees: [
          {
            root: "/wt-a",
            branch: "main",
            isMain: true,
            panes: [
              pane({ paneId: "claude-1", agent: "claude", focused: false }),
              pane({ paneId: "claude-2", agent: "claude", focused: true }),
              pane({ paneId: "ask-1", agent: "claude", ask: true }),
            ],
          },
        ],
      }),
    ];

    expect(sendTargetsFor(repos, "/wt-a", "/repo/.git").map((p) => p.paneId)).toEqual([
      "claude-2",
      "claude-1",
    ]);
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
