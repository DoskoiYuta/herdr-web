import { describe, expect, test } from "vitest";
import type { Repo } from "@contract/events";
import { inboxLocationFor, worktreeOptions } from "./inboxLocation";

function repo(overrides: Partial<Repo> & Pick<Repo, "key" | "name" | "worktrees">): Repo {
  return { counts: { blocked: 0, done: 0 }, ...overrides };
}

describe("inboxLocationFor", () => {
  // 無いと壊れる: 同じ basename の main worktree を持つ 2 リポジトリの行が、
  // どちらも "main" だけになって区別できなくなる。
  test("disambiguates repos whose basename collides, same as the sidebar", () => {
    const repos = [
      repo({
        key: "/work/foo/.git",
        name: "foo",
        worktrees: [{ root: "/work/foo", branch: "main", isMain: true, panes: [] }],
      }),
      repo({
        key: "/side/foo/.git",
        name: "foo",
        worktrees: [{ root: "/side/foo", branch: "main", isMain: true, panes: [] }],
      }),
    ];

    expect(inboxLocationFor(repos, "/work/foo/.git", "/work/foo")?.repoName).toBe("work/foo");
    expect(inboxLocationFor(repos, "/side/foo/.git", "/side/foo")?.repoName).toBe("side/foo");
  });

  test("a linked worktree resolves its branch and isMain=false", () => {
    const repos = [
      repo({
        key: "/repo/.git",
        name: "repo",
        worktrees: [
          { root: "/repo", branch: "main", isMain: true, panes: [] },
          { root: "/repo-linked", branch: "feat/x", isMain: false, panes: [] },
        ],
      }),
    ];

    const loc = inboxLocationFor(repos, "/repo/.git", "/repo-linked");
    expect(loc).toEqual({ repoName: "repo", branchLabel: "feat/x", isMain: false });
  });

  test("the main worktree always shows the label 'main', regardless of its actual branch name", () => {
    const repos = [
      repo({
        key: "/repo/.git",
        name: "repo",
        worktrees: [{ root: "/repo", branch: "trunk", isMain: true, panes: [] }],
      }),
    ];

    expect(inboxLocationFor(repos, "/repo/.git", "/repo")?.branchLabel).toBe("main");
  });

  test("returns null when the worktree root is no longer in the tree (e.g. a closed worktree)", () => {
    const repos = [
      repo({
        key: "/repo/.git",
        name: "repo",
        worktrees: [{ root: "/repo", branch: "main", isMain: true, panes: [] }],
      }),
    ];

    expect(inboxLocationFor(repos, "/repo/.git", "/repo-closed")).toBeNull();
  });

  test("returns null when worktreeRoot is null", () => {
    expect(inboxLocationFor([], null, null)).toBeNull();
  });

  // repoKey が無い行（blocked セクション）は worktreeRoot だけで全リポジトリを探す。
  test("falls back to searching every repo by worktreeRoot when repoKey is missing", () => {
    const repos = [
      repo({
        key: "/repo/.git",
        name: "repo",
        worktrees: [{ root: "/repo", branch: "main", isMain: true, panes: [] }],
      }),
    ];

    expect(inboxLocationFor(repos, null, "/repo")?.repoName).toBe("repo");
  });
});

describe("worktreeOptions", () => {
  test("orders by repo name, then main first, then branch name", () => {
    const repos = [
      repo({
        key: "/repo/terminal-diff/.git",
        name: "terminal-diff",
        worktrees: [{ root: "/repo/terminal-diff", branch: "main", isMain: true, panes: [] }],
      }),
      repo({
        key: "/repo/herdr-web/.git",
        name: "herdr-web",
        worktrees: [
          { root: "/repo/herdr-web-lanes", branch: "feat/graph-lanes", isMain: false, panes: [] },
          { root: "/repo/herdr-web", branch: "main", isMain: true, panes: [] },
        ],
      }),
    ];

    const options = worktreeOptions(repos);

    expect(options.map((o) => `${o.repoName} › ${o.branchLabel}`)).toEqual([
      "herdr-web › main",
      "herdr-web › feat/graph-lanes",
      "terminal-diff › main",
    ]);
  });

  // 無いと壊れる: basename が衝突する 2 リポジトリの main worktree が、
  // 絞り込み Select でどちらも同じ「repo-x › main」に見えてしまう。
  test("disambiguates colliding repo basenames in select labels", () => {
    const repos = [
      repo({
        key: "/work/foo/.git",
        name: "foo",
        worktrees: [{ root: "/work/foo", branch: "main", isMain: true, panes: [] }],
      }),
      repo({
        key: "/side/foo/.git",
        name: "foo",
        worktrees: [{ root: "/side/foo", branch: "main", isMain: true, panes: [] }],
      }),
    ];

    expect(worktreeOptions(repos).map((o) => o.repoName)).toEqual(["side/foo", "work/foo"]);
  });
});
