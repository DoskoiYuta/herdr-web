import { runGit } from "../../git/run";
import { locateAnchor, normalizeLine } from "../domain/anchor";
import type { GitHistory, IntroducingCommitFinder } from "../ports";
import { splitLines } from "./worktree-file-reader";

/**
 * IntroducingCommitFinder の git 実装。
 * - side=new: HEAD の内容でアンカー行を探し、`git blame -L n,n HEAD` でその行の導入コミットを取る。
 *   導入コミットが sinceHead 以前から存在する（= 祖先）なら、注釈対象の変更はまだコミットされていないので null。
 * - side=old: 削除された行は HEAD には無いので `git log -S<line> sinceHead..HEAD -- path` で
 *   その行の出現数が変わったコミットを探し、最古のものを返す。
 */
export function createGitIntroducingCommitFinder(history: GitHistory): IntroducingCommitFinder {
  return {
    async find(root, review, sinceHead) {
      const head = await history.headOf(root);
      if (!head || head === sinceHead) return null;

      if (review.anchor.side === "new") {
        const shown = await runGit(["show", `HEAD:${review.path}`], {
          cwd: root,
          okCodes: [0, 128],
        });
        if (shown.code !== 0) return null;
        const loc = locateAnchor(review.anchor, splitLines(shown.stdout));
        // F1: a bare line match (no context on either side) is not solid evidence
        // this is really the annotated line — don't blame it.
        if (!loc || loc.confidence === "line") return null;
        const blame = await runGit(
          ["blame", "--porcelain", "-L", `${loc.line},${loc.line}`, "HEAD", "--", review.path],
          { cwd: root, okCodes: [0, 128] },
        );
        if (blame.code !== 0) return null;
        const commit = blame.stdout.split(/\s/, 1)[0];
        if (!commit || !/^[0-9a-f]{40,64}$/.test(commit)) return null;
        // 既に sinceHead に含まれていた行（コンテキスト行への注釈）は「導入コミット」を持たない
        if (await history.isAncestor(root, commit, sinceHead)) return null;
        return commit;
      }

      const needle = normalizeLine(review.anchor.lines[0] ?? "");
      if (needle.length === 0) return null;
      const log = await runGit(
        ["log", "--format=%H", `-S${needle}`, `${sinceHead}..HEAD`, "--", review.path],
        { cwd: root, okCodes: [0, 128] },
      );
      if (log.code !== 0) return null;
      const commits = log.stdout.split("\n").filter(Boolean);
      return commits.at(-1) ?? null;
    },
  };
}
