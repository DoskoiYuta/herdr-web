import { describe, expect, test } from "bun:test";
import { resolvePaneWorktree, type SubRepoLike, type WorktreeEntryLike } from "./pane-worktree";
import { selectionKey, type WorkspaceSelection } from "./state";
import type { WorktreeInfo, WorktreeResolver } from "./tree";

function fakeResolver(entries: Record<string, WorktreeInfo>): WorktreeResolver {
  return {
    async resolve(path) {
      return entries[path] ?? null;
    },
  };
}

function fakeState(initial: WorkspaceSelection[] = []) {
  const rows = new Map(initial.map((s) => [selectionKey(s.workspaceId, s.repoKey), s]));
  const setCalls: Omit<WorkspaceSelection, "updatedAt">[] = [];
  return {
    setCalls,
    getSelection(workspaceId: string, repoKey: string) {
      return rows.get(selectionKey(workspaceId, repoKey)) ?? null;
    },
    async setSelection(sel: Omit<WorkspaceSelection, "updatedAt">) {
      setCalls.push(sel);
      const full: WorkspaceSelection = { ...sel, updatedAt: "t" };
      rows.set(selectionKey(sel.workspaceId, sel.repoKey), full);
      return { ok: true as const, selection: full };
    },
  };
}

const mainWt: WorktreeEntryLike = { root: "/repo", branch: "main", head: "h1", isMain: true };
const featureWt: WorktreeEntryLike = {
  root: "/repo-feature",
  branch: "feature",
  head: "h2",
  isMain: false,
};

describe("resolvePaneWorktree", () => {
  test("returns null for a pane with no cwd", async () => {
    const result = await resolvePaneWorktree(
      {
        state: fakeState(),
        resolver: fakeResolver({}),
        listWorktrees: async () => [],
        listSubRepos: async () => [],
      },
      { workspace_id: "w1", cwd: null, foreground_cwd: null },
    );
    expect(result).toBeNull();
  });

  test("with no saved selection, reports the cwd's own worktree and selectionIsDefault: true", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const result = await resolvePaneWorktree(
      {
        state: fakeState(),
        resolver,
        listWorktrees: async () => [mainWt],
        listSubRepos: async () => [],
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result).toEqual({
      worktreeRoot: "/repo",
      branch: "main",
      isMain: true,
      repoKey: "/repo/.git",
      subRepo: null,
      selectionIsDefault: true,
    });
  });

  test("a saved top-worktree selection overrides the cwd's worktree", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo-feature",
        subRepoId: null,
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt, featureWt],
        listSubRepos: async () => [],
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result).toEqual({
      worktreeRoot: "/repo-feature",
      branch: "feature",
      isMain: false,
      repoKey: "/repo/.git",
      subRepo: null,
      selectionIsDefault: false,
    });
    expect(state.setCalls).toEqual([]);
  });

  // 無いと壊れる: 選択した worktree を worktree remove で消したのに、消えた
  // worktree のパスをずっと使い続けて resolver がその後ずっと null を返す。
  test("falls back to main and persists the rewrite when the saved worktree is gone", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo-removed",
        subRepoId: null,
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt],
        listSubRepos: async () => [],
        logger: { error() {}, warn() {} },
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.worktreeRoot).toBe("/repo");
    expect(result?.selectionIsDefault).toBe(false);
    expect(state.setCalls).toEqual([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: null,
        subWorktreeRoot: null,
      },
    ]);
  });

  // 無いと壊れる: 一時的な git 失敗を「worktree が消えた」と誤認して保存済み
  // 選択を書き換えてしまう。setSelection 自体が reset を発火するので、失敗が
  // 続く間 resolve → 書き換え → reset → resolve … の無限フィードバックにもなる。
  test("a transient listWorktrees failure keeps the saved selection untouched and never calls setSelection", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo-feature",
        subRepoId: null,
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => {
          throw new Error("git worktree list: transient failure");
        },
        listSubRepos: async () => [],
        logger: { error() {}, warn() {} },
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.worktreeRoot).toBe("/repo-feature");
    expect(result?.selectionIsDefault).toBe(false);
    expect(state.setCalls).toEqual([]);
  });

  // 同上: listWorktrees が空配列を返す（一時的に何も分からない）場合も同じ扱い。
  test("an empty listWorktrees result keeps the saved selection untouched and never calls setSelection", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo-feature",
        subRepoId: null,
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [],
        listSubRepos: async () => [],
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.worktreeRoot).toBe("/repo-feature");
    expect(state.setCalls).toEqual([]);
  });

  // 同上: listSubRepos の一時失敗もサブリポジトリ選択を消してはいけない。
  test("a transient listSubRepos failure keeps the saved sub-repository selection untouched", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: "vendor/lib",
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt],
        listSubRepos: async () => {
          throw new Error("git submodule status: transient failure");
        },
        logger: { error() {}, warn() {} },
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.worktreeRoot).toBe("/repo");
    expect(state.setCalls).toEqual([]);
  });

  test("a saved sub-repository selection resolves subRepo with its own repoKey", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
      "/repo/vendor/lib": {
        root: "/repo/vendor/lib",
        commonDir: "/repo/vendor/lib/.git",
        branch: "main",
        isMain: true,
      },
    });
    const sub: SubRepoLike = {
      id: "vendor/lib",
      name: "lib",
      root: "/repo/vendor/lib",
      kind: "submodule",
      worktrees: [{ root: "/repo/vendor/lib", branch: "main", head: "h3", isMain: true }],
    };
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: "vendor/lib",
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt],
        listSubRepos: async () => [sub],
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.subRepo).toEqual({
      id: "vendor/lib",
      name: "lib",
      kind: "submodule",
      root: "/repo/vendor/lib",
      repoKey: "/repo/vendor/lib/.git",
    });
    expect(state.setCalls).toEqual([]);
  });

  // 無いと壊れる: submodule deinit 後もサーバーが古い subRepoId を使い続け、
  // トップ worktree に戻れないまま常に解決失敗（subRepo: null 止まり）になる。
  test("clears a saved sub-repository selection that no longer exists", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: "vendor/gone",
        subWorktreeRoot: null,
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt],
        // Non-empty (the root entry is always present in a real listSubRepos
        // call) and confirms "vendor/gone" genuinely isn't in it — an empty
        // list would instead mean "unknown" and must NOT clear the selection.
        listSubRepos: async () => [
          { id: "", name: "repo", root: "/repo", kind: "root", worktrees: [mainWt] },
        ],
        logger: { error() {}, warn() {} },
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.subRepo).toBeNull();
    expect(state.setCalls).toEqual([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: null,
        subWorktreeRoot: null,
      },
    ]);
  });

  test("falls back to the sub-repository's default checkout when its saved worktree is gone", async () => {
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
      "/repo/vendor/lib": {
        root: "/repo/vendor/lib",
        commonDir: "/repo/vendor/lib/.git",
        branch: "main",
        isMain: true,
      },
    });
    const sub: SubRepoLike = {
      id: "vendor/lib",
      name: "lib",
      root: "/repo/vendor/lib",
      kind: "submodule",
      worktrees: [{ root: "/repo/vendor/lib", branch: "main", head: "h3", isMain: true }],
    };
    const state = fakeState([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: "vendor/lib",
        subWorktreeRoot: "/repo/vendor/lib-linked-gone",
        updatedAt: "t0",
      },
    ]);
    const result = await resolvePaneWorktree(
      {
        state,
        resolver,
        listWorktrees: async () => [mainWt],
        listSubRepos: async () => [sub],
        logger: { error() {}, warn() {} },
      },
      { workspace_id: "w1", cwd: "/repo", foreground_cwd: null },
    );
    expect(result?.subRepo?.root).toBe("/repo/vendor/lib");
    expect(state.setCalls).toEqual([
      {
        workspaceId: "w1",
        repoKey: "/repo/.git",
        worktreeRoot: "/repo",
        subRepoId: "vendor/lib",
        subWorktreeRoot: null,
      },
    ]);
  });
});
