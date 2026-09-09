import { describe, expect, test } from "vitest";
import { displayWorktreePath } from "./WorktreeSelect";

describe("displayWorktreePath", () => {
  // 無いと壊れる: worktree サブメニューのパス表示が、main worktree 配下・
  // 兄弟ディレクトリ・無関係な場所のどれでも同じ規則で崩れずに出ることを
  // 保証する唯一のテスト（3 パターンとも実機の live check で見つかった見た目の
  // 崩れの再現条件）。
  test.each<[string, string, string, string]>([
    ["the main worktree itself", "/seed/seed-repo", "/seed/seed-repo", "."],
    ["under the main worktree root", "/seed/seed-repo", "/seed/seed-repo/sub/dir", "sub/dir"],
    [
      "a sibling worktree (git worktree add ../foo layout)",
      "/seed/seed-repo",
      "/seed/seed-repo-wt",
      "../seed-repo-wt",
    ],
    ["unrelated to the main worktree", "/seed/seed-repo", "/other/place", "/other/place"],
  ])("%s", (_label, mainRoot, root, expected) => {
    expect(displayWorktreePath(root, mainRoot)).toBe(expected);
  });
});
