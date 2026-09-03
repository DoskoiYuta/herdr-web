import type { Notify, RepoRecord, Review, ReviewStatus } from "../../contract/review";

export type { Clock } from "./domain/clock";

export type ListFilter = {
  repo?: string;
  status?: ReviewStatus[];
  targetKind?: "worktree" | "commit";
  worktreeRoot?: string;
  commit?: string;
  path?: string;
};

export interface ReviewRepository {
  get(id: string): Promise<Review | null>;
  list(filter: ListFilter): Promise<Review[]>;
  save(review: Review): Promise<void>;
  /**
   * item 1: updates ONLY the notify columns of an existing review row, leaving
   * everything else (thread, status, anchor, ...) untouched. Used everywhere the
   * notify scheduler persists a result, so it can never clobber a concurrent
   * reply/reanchor by writing back a stale full-review snapshot. A no-op if the
   * review no longer exists (e.g. deleted between read and write in a test double).
   */
  updateNotify(id: string, notify: Notify): Promise<void>;
  upsertRepo(repo: RepoRecord): Promise<void>;
  getRepo(key: string): Promise<RepoRecord | null>;
  listRepos(): Promise<RepoRecord[]>;
  /**
   * repos.key / reviews.repo / reviews.worktree_root / worktree target を前方一致で書き換える。
   * `to` が既に別リポジトリのキーとして登録済みなら `RepoMoveTargetExistsError` を投げる（F8）。
   */
  moveRepo(from: string, to: string): Promise<{ repos: number; reviews: number }>;
}

/** F8: `moveRepo` の `to` が既に別リポジトリのキーとして登録されている場合に投げる */
export class RepoMoveTargetExistsError extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`repo move target already exists: ${to}`);
    this.to = to;
  }
}

export interface GitHistory {
  headOf(root: string): Promise<string | null>;
  isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean>;
  /** from..to にあるコミット一覧。`from` が無効な rev なら null（F9: invalid_rev） */
  revRange(root: string, from: string, to: string): Promise<string[] | null>;
  /** sinceHead..HEAD で `path` がリネームされていれば新しいパスを返す（F10） */
  renamedPath(root: string, sinceHead: string, path: string): Promise<string | null>;
}

export interface IntroducingCommitFinder {
  /** sinceHead..HEAD のどのコミットがアンカーされた変更を導入したか。未コミットなら null */
  find(root: string, review: Review, sinceHead: string): Promise<string | null>;
}

export interface WorktreeFileReader {
  /** ファイルが無ければ null */
  readLines(root: string, path: string): Promise<string[] | null>;
}

export type NotifyResult = "sent" | "agent_blocked" | "no_target" | "unknown";

export interface AgentNotifier {
  notify(input: {
    worktreeRoot: string;
    commit: string | null;
    reviewIds: string[];
  }): Promise<{ result: NotifyResult; pane: string | null }>;
}

export type ReviewEvent =
  | {
      type: "review";
      event: "created" | "replied" | "resolved" | "reanchored" | "outdated";
      review: Review;
    }
  | {
      type: "review-notify";
      reviewId: string;
      result: NotifyResult;
      pane: string | null;
    };

export interface ReviewEvents {
  emit(e: ReviewEvent): void;
}

/** notifyScheduler のデバウンス用タイマー抽象。テストでは ManualTimer を使う */
export type TimerHandle = { id: number };

export interface Timer {
  setTimeout(cb: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
