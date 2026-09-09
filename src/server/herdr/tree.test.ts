import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import type { ResolvedPaneWorktree } from "./pane-worktree";
import { stateFromSnapshot } from "./state";
import { buildTree, buildWorkspaceTree } from "./tree";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

function fakeResolved(
  map: Record<string, ResolvedPaneWorktree | null>,
): Map<string, ResolvedPaneWorktree | null> {
  return new Map(Object.entries(map));
}

function resolvedFor(root: string, branch = "main", isMain = true): ResolvedPaneWorktree {
  return {
    worktreeRoot: root,
    branch,
    isMain,
    repoKey: `${root}/.git`,
    subRepo: null,
    selectionIsDefault: true,
  };
}

describe("buildTree", () => {
  test("groups panes by repository then worktree, using each pane's resolved worktree", () => {
    const state = stateFromSnapshot(snapshot);
    const resolved = fakeResolved(
      Object.fromEntries(
        [...state.panes.values()].map((p) => {
          const cwd = p.foreground_cwd ?? p.cwd ?? "";
          return [p.pane_id, resolvedFor(cwd)];
        }),
      ),
    );
    const repos = buildTree(state, resolved);
    const totalPanes = repos.reduce(
      (sum, r) => sum + r.worktrees.reduce((s, w) => s + w.panes.length, 0),
      0,
    );
    expect(totalPanes).toBe(state.panes.size);
    for (const repo of repos) {
      expect(repo.key).not.toBe("");
    }
  });

  test("panes with no resolvable git root land in the その他 group", () => {
    const state = stateFromSnapshot(snapshot);
    const resolved = fakeResolved({}); // nothing resolves
    const repos = buildTree(state, resolved);
    expect(repos).toHaveLength(1);
    expect(repos[0]!.key).toBe("other");
    expect(repos[0]!.name).toBe("その他");
    expect(repos[0]!.worktrees[0]!.panes.length).toBe(state.panes.size);
  });

  test("two panes resolved to the same repoKey but different worktreeRoot group under one Repo", () => {
    const state = stateFromSnapshot(snapshot);
    const panes = [...state.panes.values()];
    const [a, b] = panes;
    if (!a || !b) throw new Error("fixture needs >= 2 panes");
    const resolved = fakeResolved({
      [a.pane_id]: {
        worktreeRoot: "/repo",
        branch: "main",
        isMain: true,
        repoKey: "/repo/.git",
        subRepo: null,
        selectionIsDefault: true,
      },
      [b.pane_id]: {
        worktreeRoot: "/repo/worktrees/feature",
        branch: "feature",
        isMain: false,
        repoKey: "/repo/.git",
        subRepo: null,
        selectionIsDefault: true,
      },
    });
    const repos = buildTree(state, resolved);
    const repoGroup = repos.find((r) => r.key === "/repo/.git");
    expect(repoGroup).toBeDefined();
    expect(repoGroup!.worktrees.length).toBeGreaterThanOrEqual(1);
  });

  // 無いと壊れる: pane 行の worktree が選択中の TOP worktree でなく、サブ
  // リポジトリ選択時にツリーの worktree 見出し自体がサブリポジトリ側に
  // 化けてしまう（§10.3 の「pane はサブリポジトリと無関係にトップの worktree」）。
  test("a pane with a selected sub-repository still groups under its TOP worktree", () => {
    const state = stateFromSnapshot(snapshot);
    const pane = [...state.panes.values()][0]!;
    const resolved = fakeResolved({
      [pane.pane_id]: {
        worktreeRoot: "/repo",
        branch: "main",
        isMain: true,
        repoKey: "/repo/.git",
        subRepo: {
          id: "vendor/lib",
          name: "lib",
          kind: "submodule",
          root: "/repo/vendor/lib",
          repoKey: "/repo/vendor/lib/.git",
        },
        selectionIsDefault: false,
      },
    });
    const repos = buildTree(state, resolved);
    const repo = repos.find((r) => r.key === "/repo/.git")!;
    expect(repo.worktrees.map((w) => w.root)).toEqual(["/repo"]);

    // 無いと壊れる: pane 行の effectiveRoot/effectiveRepoKey がサブリポジトリ選択を
    // 反映しないと、ブラウザ側の送信先マッチングが herdr-notifier.ts と食い違う
    // （ui-redesign.md §10.6）。
    const paneRow = repo.worktrees[0]!.panes.find((p) => p.paneId === pane.pane_id)!;
    expect(paneRow.effectiveRoot).toBe("/repo/vendor/lib");
    expect(paneRow.effectiveRepoKey).toBe("/repo/vendor/lib/.git");
  });

  // 無いと壊れる: 解決できなかった pane（その他グループ）に effectiveRoot が
  // 付くと、ブラウザ側が「一致した」と誤認してしまう。
  test("panes with no resolvable git root have effectiveRoot/effectiveRepoKey left undefined", () => {
    const state = stateFromSnapshot(snapshot);
    const resolved = fakeResolved({});
    const repos = buildTree(state, resolved);
    const paneRow = repos[0]!.worktrees[0]!.panes[0]!;
    expect(paneRow.effectiveRoot).toBeUndefined();
    expect(paneRow.effectiveRepoKey).toBeUndefined();
  });

  test("counts blocked/done panes per repo", () => {
    const state = stateFromSnapshot(snapshot);
    const [firstId, firstPane] = [...state.panes.entries()][0]!;
    state.panes.set(firstId, { ...firstPane, agent_status: "blocked" });
    const resolved = fakeResolved({});
    const repos = buildTree(state, resolved);
    expect(repos[0]!.counts.blocked).toBe(1);
  });
});

describe("buildWorkspaceTree", () => {
  test("groups panes by workspace then tab", () => {
    const state = stateFromSnapshot(snapshot);
    const nodes = buildWorkspaceTree(state);
    expect(nodes.length).toBe(state.workspaces.size);
    const totalPanes = nodes.reduce(
      (sum, w) => sum + w.tabs.reduce((s, t) => s + t.panes.length, 0),
      0,
    );
    expect(totalPanes).toBe(state.panes.size);
  });
});
