import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import { stateFromSnapshot } from "./state";
import { buildTree, buildWorkspaceTree, type WorktreeInfo } from "./tree";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

function fakeResolved(map: Record<string, WorktreeInfo | null>): Map<string, WorktreeInfo | null> {
  return new Map(Object.entries(map));
}

describe("buildTree", () => {
  test("groups panes by repository then worktree, using foreground_cwd", () => {
    const state = stateFromSnapshot(snapshot);
    const resolved = fakeResolved(
      Object.fromEntries(
        [...state.panes.values()].map((p) => {
          const cwd = p.foreground_cwd ?? p.cwd ?? "";
          return [
            cwd,
            {
              root: cwd,
              commonDir: `${cwd}/.git`,
              branch: "main",
              isMain: true,
            } satisfies WorktreeInfo,
          ];
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

  test("two worktrees of the same repo (same commonDir) group under one Repo", () => {
    const state = stateFromSnapshot(snapshot);
    const panes = [...state.panes.values()];
    const [a, b] = panes;
    if (!a || !b) throw new Error("fixture needs >= 2 panes");
    const cwdA = a.foreground_cwd ?? a.cwd ?? "/repo/main";
    const resolved = fakeResolved({
      [cwdA]: { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
      "/repo/worktrees/feature": {
        root: "/repo/worktrees/feature",
        commonDir: "/repo/.git",
        branch: "feature",
        isMain: false,
      },
    });
    resolved.set(b.foreground_cwd ?? b.cwd ?? "unused", {
      root: "/repo/worktrees/feature",
      commonDir: "/repo/.git",
      branch: "feature",
      isMain: false,
    });
    const repos = buildTree(state, resolved);
    const repoGroup = repos.find((r) => r.key === "/repo/.git");
    expect(repoGroup).toBeDefined();
    expect(repoGroup!.worktrees.length).toBeGreaterThanOrEqual(1);
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
