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
import { createReviewUsecase } from "./usecases/create-review";
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
};

export const realTimer: Timer = {
  setTimeout(cb, ms) {
    const t = setTimeout(cb, ms);
    return { id: Number(t) };
  },
  clearTimeout(handle) {
    clearTimeout(handle.id);
  },
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
          gitHistory,
          template: deps.config.notify.template,
          logger,
        })
      : { notify: async () => ({ result: "no_target", pane: null }) });

  const notifyScheduler = createNotifyScheduler({
    notifier,
    events,
    repository,
    clock,
    timer,
    debounceMs: deps.config.notify.debounceMs,
    logger,
  });

  // F4: a single shared lock registry, so a reply/resolve/manual-reanchor can never
  // race a concurrent reanchorAfterChange and lose one side's update (per-review
  // locks), and two concurrent reanchorAfterChange passes on the same root serialize
  // instead of duplicating work (per-root lock).
  const locks = createLocks();

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

  const outdateWorktree = outdateWorktreeUsecase({ repository, clock, events, logger });

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
        scheduleNotify: (r) => notifyScheduler.schedule(r),
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
      listVisible: listVisibleUsecase({ repository, gitHistory }),
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
      notifyScheduler,
    },
    repoRoutes: { reassignRepo: reassignRepoUsecase({ repository }) },
  };
}

export type ReviewRuntime = ReturnType<typeof createReviewRuntime>;
