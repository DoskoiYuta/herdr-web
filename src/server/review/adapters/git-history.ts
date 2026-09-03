import { runGit } from "../../git/run";
import type { GitHistory } from "../ports";

/** GitHistory ポートの git CLI 実装。すべて読み取り専用。 */
export function createGitHistory(): GitHistory {
  return {
    async headOf(root) {
      const { stdout, code } = await runGit(["rev-parse", "--verify", "-q", "HEAD"], {
        cwd: root,
        okCodes: [0, 1],
      });
      return code === 0 ? stdout.trim() : null;
    },
    async isAncestor(root, ancestor, descendant) {
      const { code } = await runGit(["merge-base", "--is-ancestor", "--", ancestor, descendant], {
        cwd: root,
        okCodes: [0, 1, 128],
      });
      return code === 0;
    },
    async revRange(root, from, to) {
      const { stdout } = await runGit(["rev-list", `${from}..${to}`, "--"], {
        cwd: root,
        okCodes: [0, 128],
      });
      return stdout.split("\n").filter(Boolean);
    },
  };
}
