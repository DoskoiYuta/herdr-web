import { ResultAsync } from "neverthrow";
import type { ReviewCountsResponse } from "../../../contract/review";
import type { ReviewRepository } from "../ports";
import type { ListVisibleUsecase } from "./list-visible";

export type CountsDeps = { repository: ReviewRepository; listVisible: ListVisibleUsecase };
export type CountsInput = { repo: string; worktree: string };

/**
 * `GET /api/review/counts`。git graph のバッジ用の集計は repository.list を、
 * `pendingDrafts`（送信ボタン用）は listVisible（`hw review list --all` と同じ可視性ルール）を
 * メモリ上で畳み込んで作る。
 */
export function countsUsecase(deps: CountsDeps) {
  return function countsFn(input: CountsInput): ResultAsync<ReviewCountsResponse, never> {
    return ResultAsync.fromSafePromise(
      (async () => {
        const reviews = await deps.repository.list({ repo: input.repo });

        const byCommit: ReviewCountsResponse["byCommit"] = {};
        let worktreeUnresolved = 0;
        let worktreeDrafts = 0;

        for (const review of reviews) {
          const hasDraft = review.thread.some((e) => e.draft);
          const hasSent = review.thread.some((e) => !e.draft);
          const unresolved = (review.status === "open" || review.status === "replied") && hasSent;

          if (review.target.kind === "commit") {
            const hash = review.target.hash;
            const existing = byCommit[hash] ?? { unresolved: 0, drafts: 0 };
            byCommit[hash] = {
              unresolved: existing.unresolved + (unresolved ? 1 : 0),
              drafts: existing.drafts + (hasDraft ? 1 : 0),
            };
          } else if (review.target.root === input.worktree) {
            worktreeUnresolved += unresolved ? 1 : 0;
            worktreeDrafts += hasDraft ? 1 : 0;
          }
        }

        for (const hash of Object.keys(byCommit)) {
          const c = byCommit[hash]!;
          if (c.unresolved === 0 && c.drafts === 0) delete byCommit[hash];
        }

        const visible = await deps.listVisible({
          repo: input.repo,
          worktreeRoot: input.worktree,
          opts: { all: true },
        });
        const pendingDrafts = visible.isOk()
          ? visible.value.filter((r) => r.thread.some((e) => e.draft)).length
          : 0;
        // Diff タブの通知バッジ (plan/ui-redesign §5.4): この worktree から
        // 見える（listVisible と同じ可視性の）replied 件数。
        const replied = visible.isOk()
          ? visible.value.filter((r) => r.status === "replied").length
          : 0;

        return {
          byCommit,
          worktree: { unresolved: worktreeUnresolved, drafts: worktreeDrafts },
          pendingDrafts,
          replied,
        };
      })(),
    );
  };
}
