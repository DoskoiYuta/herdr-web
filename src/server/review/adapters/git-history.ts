import { runGit } from "../../git/run";
import type { GitHistory } from "../ports";

const RENAME_LINE_RE = /^R\d+\t(.+)\t(.+)$/;

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
      const { stdout, code } = await runGit(
        ["diff", "--name-status", "-M", `${sinceHead}`, "HEAD", "--"],
        { cwd: root, okCodes: [0, 128] },
      );
      if (code !== 0) return null;
      for (const line of stdout.split("\n")) {
        const m = RENAME_LINE_RE.exec(line);
        if (m && m[1] === path) return m[2]!;
      }
      return null;
    },
  };
}
