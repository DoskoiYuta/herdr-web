import { ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { locateAnchor, type AnchorLocation } from "../domain/anchor";
import type { ListFilter, ReviewRepository } from "../ports";

export type ForDiffInput = {
  repo: string;
  /** to が WORKTREE/INDEX のとき、worktree 付きレビューを絞り込むための worktree ルート */
  worktreeRoot?: string;
  from: string;
  to: string;
  path: string;
  sideLines: { old: string[]; new: string[] };
};

export type ForDiffDeps = { repository: ReviewRepository };

export type ForDiffMatch = {
  review: Review;
  line: number;
  span: number;
  confidence: AnchorLocation["confidence"];
};

const WORKTREE_LIKE_TO = new Set(["WORKTREE", "INDEX"]);

/** 指定 diff にアンカー一致するレビューと、現在の行位置を返す */
export function forDiffUsecase(deps: ForDiffDeps) {
  return function forDiffFn(input: ForDiffInput): ResultAsync<ForDiffMatch[], never> {
    return ResultAsync.fromSafePromise(
      (async () => {
        const isWorktreeDiff = WORKTREE_LIKE_TO.has(input.to);
        const filter: ListFilter = isWorktreeDiff
          ? {
              repo: input.repo,
              targetKind: "worktree",
              worktreeRoot: input.worktreeRoot,
              path: input.path,
            }
          : { repo: input.repo, targetKind: "commit", commit: input.to, path: input.path };

        const reviews = await deps.repository.list(filter);
        const matches: ForDiffMatch[] = [];
        for (const review of reviews) {
          const lines = review.anchor.side === "old" ? input.sideLines.old : input.sideLines.new;
          const loc = locateAnchor(review.anchor, lines);
          if (loc) {
            matches.push({ review, line: loc.line, span: loc.span, confidence: loc.confidence });
          }
        }
        return matches;
      })(),
    );
  };
}
