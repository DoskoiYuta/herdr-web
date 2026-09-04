import { err, ok, ResultAsync, type Result } from "neverthrow";
import type { Review } from "../../../contract/review";
import { send as sendDomain } from "../domain/transitions";
import type { AgentNotifier, Clock, ReviewEvents, ReviewRepository } from "../ports";
import { ambiguousTarget, invalidTarget, noAgent, type SendTargetError } from "./errors";
import { createLocks, type Locks } from "./locks";
import type { ListVisibleUsecase } from "./list-visible";
import type { NotifyScheduler } from "./notify-scheduler";

export type SendDraftsDeps = {
  repository: ReviewRepository;
  events: ReviewEvents;
  clock: Clock;
  notifyScheduler: NotifyScheduler;
  /** 送信先候補（`targetsAt`）を解決するのに使う。送信そのものは notifyScheduler 経由 */
  notifier: AgentNotifier;
  /** `hw review list` と同じ可視性ルールで送信対象を選ぶ */
  listVisible: ListVisibleUsecase;
  /** F4 と同じ流儀: review ごとにロックして reply/reanchor との競合を避ける */
  locks?: Locks;
};

export type SendDraftsInput = { repo: string; worktreeRoot: string; pane?: string };

/**
 * `POST /api/review/send`。`worktreeRoot` にいる agent pane（`AgentNotifier.targetsAt`）を
 * 先に解決する: 0 件なら `no_agent`、複数かつ `pane` 未指定なら `ambiguous_target`、
 * `pane` が候補外なら `invalid_target` を返し、どの場合も下書きは一切変更しない。
 * 解決できたら `worktreeRoot` から可視な（`hw review list --all` と同じ規則）review のうち
 * 下書きを 1 件以上持つものをすべて送信済みにし、選んだ pane へまとめて 1 回だけ通知する。
 */
export function sendDraftsUsecase(deps: SendDraftsDeps) {
  const locks = deps.locks ?? createLocks();

  return function sendDraftsFn(
    input: SendDraftsInput,
  ): ResultAsync<{ reviews: Review[] }, SendTargetError> {
    return new ResultAsync<{ reviews: Review[] }, SendTargetError>(
      (async (): Promise<Result<{ reviews: Review[] }, SendTargetError>> => {
        const targets = await deps.notifier.targetsAt(input.worktreeRoot);
        if (targets.length === 0) return err(noAgent(input.worktreeRoot));

        let pane: string;
        if (input.pane) {
          if (!targets.some((t) => t.pane === input.pane)) return err(invalidTarget(input.pane));
          pane = input.pane;
        } else if (targets.length > 1) {
          return err(ambiguousTarget(targets.map((t) => t.pane)));
        } else {
          pane = targets[0]!.pane;
        }

        const visible = await deps.listVisible({
          repo: input.repo,
          worktreeRoot: input.worktreeRoot,
          opts: { all: true },
        });
        const candidates = visible.isOk() ? visible.value : [];
        const toSend = candidates.filter((r) => r.thread.some((e) => e.draft));

        const sent: Review[] = [];
        for (const review of toSend) {
          await locks.withLock(`review:${review.id}`, async () => {
            const current = (await deps.repository.get(review.id)) ?? review;
            const result = sendDomain(current, deps.clock);
            if (result.isErr()) return;
            await deps.repository.save(result.value);
            deps.events.emit({ type: "review", event: "sent", review: result.value });
            sent.push(result.value);
          });
        }

        for (const review of sent) {
          deps.notifyScheduler.schedule(review, input.worktreeRoot, pane);
        }
        await deps.notifyScheduler.flush();

        return ok({ reviews: sent });
      })(),
    );
  };
}
