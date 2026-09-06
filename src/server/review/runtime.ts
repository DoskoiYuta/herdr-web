import type { Config } from "../../contract/config";
import { openDb, type Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import type { HerdrGateway } from "../herdr/gateway";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { createGitHistory } from "./adapters/git-history";
import { createGitIntroducingCommitFinder } from "./adapters/git-introducing-commit";
import { createHerdrNotifier } from "./adapters/herdr-notifier";
import { createSqliteReviewRepository } from "./adapters/sqlite-repository";
import { createWorktreeFileReader } from "./adapters/worktree-file-reader";
import type {
  AgentNotifier,
  Clock,
  GitHistory,
  IntroducingCommitFinder,
  ReviewEvent,
  Timer,
  WorktreeFileReader,
} from "./ports";
import { realTimer } from "./usecases/locks";
import { countsUsecase } from "./usecases/counts";
import { createReviewUsecase } from "./usecases/create-review";
import { deleteDraftUsecase } from "./usecases/delete-draft";
import { editDraftUsecase } from "./usecases/edit-draft";
import { forDiffUsecase } from "./usecases/for-diff";
import { listVisibleUsecase } from "./usecases/list-visible";
import { createLocks } from "./usecases/locks";
import { createNotifyScheduler } from "./usecases/notify-scheduler";
import { outdateWorktreeUsecase } from "./usecases/outdate-worktree";
import { reanchorAfterChangeUsecase } from "./usecases/reanchor-after-change";
import { reanchorReviewUsecase } from "./usecases/reanchor-review";
import { reassignRepoUsecase } from "./usecases/reassign-repo";
import { replyToReviewUsecase } from "./usecases/reply-to-review";
import { resolveReviewUsecase } from "./usecases/resolve-review";
import { sendDraftsUsecase } from "./usecases/send-drafts";

export type ReviewRuntimeDeps = {
  config: Pick<Config, "notify">;
  db: Db;
  /** 通知先解決に使う。herdr 無しのテストでは notifier を直接渡す。 */
  herdr?: { state: HerdrStateStore; gateway: HerdrGateway; resolver: WorktreeResolver };
  notifier?: AgentNotifier;
  gitHistory?: GitHistory;
  finder?: IntroducingCommitFinder;
  fileReader?: WorktreeFileReader;
  clock?: Clock;
  timer?: Timer;
  onEvent: (e: ReviewEvent) => void;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
  /**
   * item 3: whether herdr is currently connected — the notify scheduler checks
   * this before firing so it never persists `no_target` (unretryable) while
   * disconnected. Defaults to `herdr.gateway.status().connected` when `herdr`
   * is provided, else always-connected (matches the fallback no-op notifier).
   */
  isConnected?: () => boolean;
};

export function openReviewDb(path: string): Db {
  const db = openDb(path);
  applyMigrations(db);
  return db;
}

/** review のポートをアダプタで埋めてユースケース一式を組み立てる。routes/review.ts の deps を返す。 */
export function createReviewRuntime(deps: ReviewRuntimeDeps) {
  const logger = deps.logger ?? console;
  const clock: Clock = deps.clock ?? { now: () => new Date() };
  const timer = deps.timer ?? realTimer;
  const events = { emit: deps.onEvent };
  const repository = createSqliteReviewRepository(deps.db);
  const gitHistory = deps.gitHistory ?? createGitHistory();
  const finder = deps.finder ?? createGitIntroducingCommitFinder(gitHistory);
  const fileReader = deps.fileReader ?? createWorktreeFileReader();
  const notifier: AgentNotifier =
    deps.notifier ??
    (deps.herdr
      ? createHerdrNotifier({
          ...deps.herdr,
          template: deps.config.notify.template,
          logger,
        })
      : {
          targetsAt: async () => [],
          notify: async () => ({ result: "no_target" as const, pane: null }),
        });

  // F4: a single shared lock registry, so a reply/resolve/manual-reanchor can never
  // race a concurrent reanchorAfterChange and lose one side's update (per-review
  // locks), and two concurrent reanchorAfterChange passes on the same root serialize
  // instead of duplicating work (per-root lock). Also used by the notify scheduler
  // (item 1) so it can never overwrite a concurrent reply's write.
  const locks = createLocks();

  const isConnected: () => boolean =
    deps.isConnected ?? (deps.herdr ? () => deps.herdr!.gateway.status().connected : () => true);

  const notifyScheduler = createNotifyScheduler({
    notifier,
    events,
    repository,
    clock,
    timer,
    debounceMs: deps.config.notify.debounceMs,
    logger,
    locks,
    isConnected,
  });

  const reanchorAfterChange = reanchorAfterChangeUsecase({
    repository,
    fileReader,
    finder,
    gitHistory,
    clock,
    events,
    locks,
    logger,
  });

  const outdateWorktree = outdateWorktreeUsecase({ repository, clock, events, locks, logger });

  const listVisible = listVisibleUsecase({ repository, gitHistory });

  return {
    repository,
    gitHistory,
    notifyScheduler,
    reanchorAfterChange,
    outdateWorktree,
    routes: {
      repository,
      createReview: createReviewUsecase({
        repository,
        events,
        clock,
        // F3: a stale createdAtHead (poller missed a commit, or HEAD moved between
        // loading the diff and the POST landing) is commit-bound immediately rather
        // than waiting for the next repo-changed tick.
        afterCreate: async (review) => {
          if (review.target.kind !== "worktree") return;
          const head = await gitHistory.headOf(review.worktreeRoot);
          if (head && head !== review.createdAtHead) {
            await reanchorAfterChange({
              repo: review.repo,
              worktreeRoot: review.worktreeRoot,
              prevHead: null,
              head,
            });
          }
        },
      }),
      replyToReview: replyToReviewUsecase({ repository, events, clock, locks }),
      resolveReview: resolveReviewUsecase({ repository, events, clock, locks }),
      listVisible,
      forDiff: forDiffUsecase({ repository }),
      reanchorReview: reanchorReviewUsecase({
        repository,
        fileReader,
        finder,
        gitHistory,
        clock,
        events,
        locks,
      }),
      editDraft: editDraftUsecase({ repository, events, clock, locks }),
      deleteDraft: deleteDraftUsecase({ repository, events, clock, locks }),
      sendDrafts: sendDraftsUsecase({
        repository,
        events,
        clock,
        notifyScheduler,
        notifier,
        listVisible,
        locks,
      }),
      counts: countsUsecase({ repository, listVisible }),
      notifyScheduler,
    },
    repoRoutes: { reassignRepo: reassignRepoUsecase({ repository }) },
  };
}

export type ReviewRuntime = ReturnType<typeof createReviewRuntime>;
