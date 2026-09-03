import { describe, expect, test } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import { reduceRepos } from "./herdrReducer";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "pane-1",
    workspaceId: "ws-1",
    workspaceLabel: null,
    tabLabel: null,
    tabId: "tab-1",
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

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    key: "/repo/.git",
    name: "repo",
    worktrees: [{ root: "/repo", branch: "main", isMain: true, panes: [pane()] }],
    counts: { blocked: 0, done: 0 },
    ...overrides,
  };
}

describe("reduceRepos: tree", () => {
  test("replaces the whole tree", () => {
    const initial = [repo()];
    const next = reduceRepos(initial, { type: "tree", repos: [] });
    expect(next).toEqual([]);
  });
});

describe("reduceRepos: pane-updated", () => {
  test("inserts a new pane into an existing worktree", () => {
    const initial = [repo()];
    const row = pane({ paneId: "pane-2", agentStatus: "blocked" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/repo",
      repoKey: "/repo/.git",
    });
    expect(next[0]!.worktrees[0]!.panes.map((p) => p.paneId)).toEqual(["pane-1", "pane-2"]);
    expect(next[0]!.counts).toEqual({ blocked: 1, done: 0 });
  });

  test("updates an existing pane in place", () => {
    const initial = [repo()];
    const row = pane({ agentStatus: "done" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/repo",
      repoKey: "/repo/.git",
    });
    expect(next[0]!.worktrees[0]!.panes).toEqual([row]);
    expect(next[0]!.counts).toEqual({ blocked: 0, done: 1 });
  });

  test("moving a pane to a different worktree removes it from the old one", () => {
    const initial = [
      repo({
        worktrees: [
          { root: "/repo", branch: "main", isMain: true, panes: [pane()] },
          { root: "/repo-feature", branch: "feature", isMain: false, panes: [] },
        ],
      }),
    ];
    const row = pane({ cwd: "/repo-feature", foregroundCwd: "/repo-feature" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/repo-feature",
      repoKey: "/repo/.git",
    });
    expect(next[0]!.worktrees).toHaveLength(1);
    expect(next[0]!.worktrees[0]!.root).toBe("/repo-feature");
    expect(next[0]!.worktrees[0]!.panes).toEqual([row]);
  });

  test("moving a pane to an unseen repo/worktree creates a minimal group from repoKey/worktreeRoot", () => {
    const initial = [repo()];
    const row = pane({ paneId: "pane-9", cwd: "/other-repo", foregroundCwd: "/other-repo" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/other-repo",
      repoKey: "/other-repo/.git",
    });
    expect(next).toHaveLength(2);
    const newRepo = next.find((r) => r.key === "/other-repo/.git");
    expect(newRepo).toBeDefined();
    expect(newRepo!.name).toBe("other-repo");
    expect(newRepo!.worktrees[0]).toMatchObject({
      root: "/other-repo",
      branch: null,
      isMain: true,
    });
    expect(newRepo!.worktrees[0]!.panes).toEqual([row]);
  });

  test("a pane with no resolvable worktree/repo lands in the その他 sentinel group", () => {
    const initial = [repo()];
    const row = pane({ cwd: null, foregroundCwd: null });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: null,
      repoKey: null,
    });
    // /repo's group is now empty and dropped; a new "other" sentinel group holds the pane.
    expect(next).toHaveLength(1);
    const other = next.find((r) => r.key === "other");
    expect(other).toBeDefined();
    expect(other!.name).toBe("その他");
    expect(other!.worktrees[0]!.root).toBe("other");
    expect(other!.worktrees[0]!.panes).toEqual([row]);
  });

  test("a second unresolvable pane joins the same その他 sentinel worktree", () => {
    const initial = [repo()];
    const rowA = pane({ paneId: "pane-a", cwd: null, foregroundCwd: null });
    const rowB = pane({ paneId: "pane-b", cwd: null, foregroundCwd: null });
    const afterA = reduceRepos(initial, {
      type: "pane-updated",
      row: rowA,
      worktreeRoot: null,
      repoKey: null,
    });
    const afterB = reduceRepos(afterA, {
      type: "pane-updated",
      row: rowB,
      worktreeRoot: null,
      repoKey: null,
    });
    const other = afterB.find((r) => r.key === "other");
    expect(other!.worktrees).toHaveLength(1);
    expect(other!.worktrees[0]!.panes.map((p) => p.paneId)).toEqual(["pane-a", "pane-b"]);
  });

  test("an empty worktree/repo left behind by a move is dropped", () => {
    const initial = [
      repo({
        key: "a",
        worktrees: [{ root: "/a", branch: "main", isMain: true, panes: [pane()] }],
      }),
    ];
    const row = pane({ cwd: "/b", foregroundCwd: "/b" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/b",
      repoKey: "b",
    });
    expect(next.find((r) => r.key === "a")).toBeUndefined();
    expect(next.find((r) => r.key === "b")?.worktrees[0]?.root).toBe("/b");
  });

  test("repos sort alphabetically by name with the 'other' sentinel last", () => {
    const initial = [
      repo({
        key: "other",
        name: "その他",
        worktrees: [
          { root: "other", branch: null, isMain: true, panes: [pane({ paneId: "p-other" })] },
        ],
      }),
      repo({
        key: "z-repo",
        name: "zeta",
        worktrees: [{ root: "/z", branch: "main", isMain: true, panes: [pane({ paneId: "p-z" })] }],
      }),
    ];
    const row = pane({ paneId: "p-alpha", cwd: "/a", foregroundCwd: "/a" });
    const next = reduceRepos(initial, {
      type: "pane-updated",
      row,
      worktreeRoot: "/a",
      repoKey: "a-repo",
    });
    expect(next.map((r) => r.key)).toEqual(["a-repo", "z-repo", "other"]);
  });
});

describe("reduceRepos: pane-removed", () => {
  test("removes the pane and drops the now-empty worktree/repo", () => {
    const initial = [repo()];
    const next = reduceRepos(initial, { type: "pane-removed", pane: "pane-1" });
    expect(next).toEqual([]);
  });

  test("leaves a worktree with remaining panes intact", () => {
    const initial = [
      repo({
        worktrees: [
          {
            root: "/repo",
            branch: "main",
            isMain: true,
            panes: [pane(), pane({ paneId: "pane-2", agentStatus: "blocked" })],
          },
        ],
      }),
    ];
    const next = reduceRepos(initial, { type: "pane-removed", pane: "pane-1" });
    expect(next[0]!.worktrees[0]!.panes.map((p) => p.paneId)).toEqual(["pane-2"]);
    expect(next[0]!.counts).toEqual({ blocked: 1, done: 0 });
  });

  test("removing an unknown pane id is a no-op", () => {
    const initial = [repo()];
    const next = reduceRepos(initial, { type: "pane-removed", pane: "missing" });
    expect(next).toEqual(initial);
  });
});
