import { ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { locateAnchor } from "../domain/anchor";
import { markOutdated, reanchorToCommit, retargetCommit } from "../domain/transitions";
import type {
  Clock,
  GitHistory,
  IntroducingCommitFinder,
  ReviewEvents,
  ReviewRepository,
  WorktreeFileReader,
} from "../ports";

export type ReanchorAfterChangeDeps = {
  repository: ReviewRepository;
  fileReader: WorktreeFileReader;
  finder: IntroducingCommitFinder;
  gitHistory: GitHistory;
  clock: Clock;
  events: ReviewEvents;
};

export type ReanchorAfterChangeInput = {
  repo: string;
  worktreeRoot: string;
  prevHead: string;
  head: string;
};

/**
 * plan §F5-4 / §F5-5:
 *  - worktree 付き非 outdated レビュー: ファイルが無ければ outdated、行が見つからなければ outdated、
 *    見つかって HEAD が動いていれば導入コミットを探し、見つかれば commit へ確定する。
 *  - commit 付きレビューで commit が HEAD の祖先でなくなった（rebase/squash）場合は、
 *    内容一致で新しい commit を探して retarget。見つからなければそのまま（--unreachable で拾う）。
 */
/**
 * 未コミットの変更がまだ作業ツリーに残っているか。
 * - side=new（追加・変更行）: 行が作業ツリーに無ければ消えた。
 * - side=old（削除行）: 削除が有効な間は行は作業ツリーに **無い**。行が戻っていれば削除が取り消された＝消えた。
 *   ファイル自体が無い場合も削除は有効なので消えていない扱い。
 */
export function anchorGone(review: Review, lines: string[] | null): boolean {
  if (review.anchor.side === "old") {
    if (lines === null) return false;
    return locateAnchor(review.anchor, lines) !== null;
  }
  if (lines === null) return true;
  return locateAnchor(review.anchor, lines) === null;
}

export function reanchorAfterChangeUsecase(deps: ReanchorAfterChangeDeps) {
  return function reanchorAfterChangeFn(
    input: ReanchorAfterChangeInput,
  ): ResultAsync<Review[], never> {
    return ResultAsync.fromSafePromise(
      (async () => {
        const changed: Review[] = [];
        const handledIds = new Set<string>();

        const worktreeReviews = await deps.repository.list({
          repo: input.repo,
          worktreeRoot: input.worktreeRoot,
          targetKind: "worktree",
        });
        // 先に取得しておく: worktree ループでの save により rebase チェック対象になるのを防ぐ
        const commitReviews = await deps.repository.list({
          repo: input.repo,
          targetKind: "commit",
        });

        for (const review of worktreeReviews) {
          if (review.status === "outdated") continue;

          const lines = await deps.fileReader.readLines(input.worktreeRoot, review.path);
          let next: Review | null = null;

          const gone = anchorGone(review, lines);
          if (gone) {
            const r = markOutdated(review, deps.clock);
            if (r.isOk()) next = r.value;
          } else if (input.head !== input.prevHead) {
            const commit = await deps.finder.find(input.worktreeRoot, review, input.prevHead);
            if (commit) {
              const r = reanchorToCommit(review, commit, deps.clock);
              if (r.isOk()) next = r.value;
            }
          }

          if (next) {
            await deps.repository.save(next);
            handledIds.add(next.id);
            deps.events.emit({
              type: "review",
              event: next.status === "outdated" ? "outdated" : "reanchored",
              review: next,
            });
            changed.push(next);
          }
        }

        for (const review of commitReviews) {
          if (handledIds.has(review.id)) continue;
          if (review.target.kind !== "commit") continue;
          const reachable = await deps.gitHistory.isAncestor(
            input.worktreeRoot,
            review.target.hash,
            input.head,
          );
          if (reachable) continue;

          const commit = await deps.finder.find(input.worktreeRoot, review, review.createdAtHead);
          if (!commit) continue; // 見つからなければそのまま。--unreachable で引ける

          const r = retargetCommit(review, commit, deps.clock);
          if (r.isOk()) {
            await deps.repository.save(r.value);
            deps.events.emit({ type: "review", event: "reanchored", review: r.value });
            changed.push(r.value);
          }
        }

        return changed;
      })(),
    );
  };
}
