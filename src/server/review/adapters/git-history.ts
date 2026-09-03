import { runGit } from "../../git/run";
import type { GitHistory } from "../ports";

/** GitHistory ポートの git CLI 実装。すべて読み取り専用。 */
export function createGitHistory(): GitHistory {
  return {
    async headOf(root) {
      // F6: worktree ルートが消えている場合 execFile 自体が ENOENT で reject しうる。
      // reject させず null に丸める（listVisible が worktree-bound only にフォールバックできるように）。
      try {
        const { stdout, code } = await runGit(["rev-parse", "--verify", "-q", "HEAD"], {
          cwd: root,
          okCodes: [0, 1],
        });
        return code === 0 ? stdout.trim() : null;
      } catch {
        return null;
      }
    },
    async isAncestor(root, ancestor, descendant) {
      const { code } = await runGit(["merge-base", "--is-ancestor", "--", ancestor, descendant], {
        cwd: root,
        okCodes: [0, 1, 128],
      });
      return code === 0;
    },
    async revRange(root, from, to) {
      const { stdout, code } = await runGit(["rev-list", `${from}..${to}`, "--"], {
        cwd: root,
        okCodes: [0, 128],
      });
      if (code === 128) return null; // F9: invalid rev
      return stdout.split("\n").filter(Boolean);
    },
    async renamedPath(root, sinceHead, path) {
      // F4: compare `sinceHead` against the worktree (no second rev), not
      // `sinceHead..HEAD` — a `git diff <rev> --` walks the tree straight to
      // the on-disk files (bypassing the index for the comparison itself), so
      // it sees a `git mv` the moment it's staged, not only once committed.
      // `-z` gives us NUL-separated `status\0old\0new\0...` tokens that are
      // unambiguous regardless of path contents (unlike the tab-delimited
      // non-`-z` form).
      const { stdout, code } = await runGit(
        ["diff", "--name-status", "-M", "-z", sinceHead, "--"],
        {
          cwd: root,
          okCodes: [0, 128],
        },
      );
      if (code !== 0) return null;
      const tokens = stdout.split("\0").filter((t) => t.length > 0);
      let i = 0;
      while (i < tokens.length) {
        const status = tokens[i]!;
        // Renames (R###) and copies (C###) carry two path tokens; every other
        // status (A/M/D/T/U/X...) carries exactly one.
        if (status.startsWith("R") || status.startsWith("C")) {
          const oldPath = tokens[i + 1];
          const newPath = tokens[i + 2];
          if (status.startsWith("R") && oldPath === path && newPath) return newPath;
          i += 3;
        } else {
          i += 2;
        }
      }
      return null;
    },
  };
}
