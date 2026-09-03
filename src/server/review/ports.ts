import type { RepoRecord, Review, ReviewStatus } from "../../contract/review";

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
  upsertRepo(repo: RepoRecord): Promise<void>;
  getRepo(key: string): Promise<RepoRecord | null>;
  listRepos(): Promise<RepoRecord[]>;
  /** repos.key / reviews.repo / reviews.worktree_root / worktree target を前方一致で書き換える */
  moveRepo(from: string, to: string): Promise<{ repos: number; reviews: number }>;
}

export interface GitHistory {
  headOf(root: string): Promise<string | null>;
  isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean>;
  /** from..to にあるコミット一覧 */
  revRange(root: string, from: string, to: string): Promise<string[]>;
}

export interface IntroducingCommitFinder {
  /** sinceHead..HEAD のどのコミットがアンカーされた変更を導入したか。未コミットなら null */
  find(root: string, review: Review, sinceHead: string): Promise<string | null>;
}

export interface WorktreeFileReader {
  /** ファイルが無ければ null */
  readLines(root: string, path: string): Promise<string[] | null>;
}

export interface AgentNotifier {
  notify(input: {
    worktreeRoot: string;
    commit: string | null;
    reviewIds: string[];
  }): Promise<{ result: "sent" | "agent_blocked" | "no_target"; pane: string | null }>;
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
      result: "sent" | "agent_blocked" | "no_target";
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
