import { ResultAsync } from "neverthrow";
import type { Review } from "../../../contract/review";
import { locateAnchor } from "../domain/anchor";
import { markOutdated, moveToPath, reanchorToCommit, retargetCommit } from "../domain/transitions";
import { createLocks, type Locks } from "./locks";
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
  /** F4: per-review / per-root serialization. Defaults to a private registry when omitted (tests). */
  locks?: Locks;
  logger?: Pick<typeof console, "info">;
};

export type ReanchorAfterChangeInput = {
  repo: string;
  worktreeRoot: string;
  /** 直前に観測した HEAD。未知（起動直後など）なら null — その場合 rebase 検出はスキップする (F2/F3) */
  prevHead: string | null;
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
 * - side=new（追加・変更行）: 行が作業ツリーに無ければ消えた。bare な行一致（confidence "line"）は
 *   前後の内容が一致しない弱い証拠でしかないため「見つからなかった」扱いにする (F1)。
 * - side=old（削除行）: 削除が有効な間は行は作業ツリーに **無い**。行が exact/context で戻っていれば
 *   削除が取り消された＝消えた。bare な一致では「戻った」と判断しない (F1)。
 *   ファイル自体が無い場合も削除は有効なので消えていない扱い。
 */
export function anchorGone(review: Review, lines: string[] | null): boolean {
  if (review.anchor.side === "old") {
    if (lines === null) return false;
    const loc = locateAnchor(review.anchor, lines);
    return loc !== null && loc.confidence !== "line";
  }
  if (lines === null) return true;
  const loc = locateAnchor(review.anchor, lines);
  return loc === null || loc.confidence === "line";
}

export function reanchorAfterChangeUsecase(deps: ReanchorAfterChangeDeps) {
  const locks = deps.locks ?? createLocks();
  const logger = deps.logger ?? console;

  return function reanchorAfterChangeFn(
    input: ReanchorAfterChangeInput,
  ): ResultAsync<Review[], never> {
    return ResultAsync.fromSafePromise(
      // F4c: serialize concurrent reanchorAfterChange calls for the same worktree root,
      // so a second concurrent pass can't re-list and re-emit events for reviews the
      // first pass already handled.
      locks.withLock(`root:${input.worktreeRoot}`, async () => {
        const changed: Review[] = [];
        const handledIds = new Set<string>();

        const worktreeReviews = await deps.repository.list({
          repo: input.repo,
          worktreeRoot: input.worktreeRoot,
          targetKind: "worktree",
        });
        const commitReviews = await deps.repository.list({
          repo: input.repo,
          targetKind: "commit",
        });

        for (const listed of worktreeReviews) {
          if (listed.status === "outdated") continue;

          // F4b: re-fetch under the per-review lock so we never clobber a
          // concurrent reply/resolve/manual-reanchor that ran while we were
          // waiting (or since this batch was listed).
          await locks.withLock(`review:${listed.id}`, async () => {
            const review = (await deps.repository.get(listed.id)) ?? listed;
            if (review.status === "outdated") return;

            let working = review;
            let lines = await deps.fileReader.readLines(input.worktreeRoot, working.path);
            let renamed = false;

            // F10: a side=new anchor whose file vanished may just have moved.
            if (lines === null && working.anchor.side === "new") {
              const newPath = await deps.gitHistory.renamedPath(
                input.worktreeRoot,
                working.createdAtHead,
                working.path,
              );
              if (newPath) {
                const moved = moveToPath(working, newPath, deps.clock);
                if (moved.isOk()) {
                  working = moved.value;
                  lines = await deps.fileReader.readLines(input.worktreeRoot, newPath);
                  renamed = true;
                }
              }
            }

            let next: Review | null = null;
            if (anchorGone(working, lines)) {
              const r = markOutdated(working, deps.clock);
              if (r.isOk()) {
                next = r.value;
                logger.info(`review outdated id=${working.id} reason=anchor-gone`);
              }
            } else if (input.head !== working.createdAtHead) {
              const commit = await deps.finder.find(
                input.worktreeRoot,
                working,
                working.createdAtHead,
              );
              if (commit) {
                const r = reanchorToCommit(working, commit, deps.clock);
                if (r.isOk()) {
                  next = r.value;
                  logger.info(`review commit-bound id=${working.id} commit=${commit}`);
                }
              } else if (renamed) {
                next = working;
              } else {
                logger.info(`reanchor skipped id=${working.id} reason=finder-null`);
              }
            } else if (renamed) {
              next = working;
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
          });
        }

        for (const listed of commitReviews) {
          if (handledIds.has(listed.id)) continue;
          if (listed.target.kind !== "commit") continue;

          await locks.withLock(`review:${listed.id}`, async () => {
            const review = (await deps.repository.get(listed.id)) ?? listed;
            if (review.target.kind !== "commit") return;

            const reachable = await deps.gitHistory.isAncestor(
              input.worktreeRoot,
              review.target.hash,
              input.head,
            );
            if (reachable) return;

            // F2/F3: only this worktree's own history can "rebase away" a commit it
            // once had reachable — a commit this worktree never saw is not ours to
            // touch just because some *other* worktree squashed/rebased it away.
            if (input.prevHead === null) return;
            const wasReachableFromPrev = await deps.gitHistory.isAncestor(
              input.worktreeRoot,
              review.target.hash,
              input.prevHead,
            );
            if (!wasReachableFromPrev) return;

            const commit = await deps.finder.find(input.worktreeRoot, review, review.createdAtHead);
            if (!commit) return; // 見つからなければそのまま。--unreachable で引ける

            const r = retargetCommit(review, commit, deps.clock);
            if (r.isOk()) {
              await deps.repository.save(r.value);
              logger.info(`review commit-bound id=${r.value.id} commit=${commit}`);
              deps.events.emit({ type: "review", event: "reanchored", review: r.value });
              changed.push(r.value);
            }
          });
        }

        return changed;
      }),
    );
  };
}
