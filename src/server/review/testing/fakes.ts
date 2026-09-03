import type { RepoRecord, Review } from "../../../contract/review";
import type { Clock } from "../domain/clock";
import { RepoMoveTargetExistsError } from "../ports";
import type {
  AgentNotifier,
  GitHistory,
  IntroducingCommitFinder,
  ListFilter,
  ReviewEvent,
  ReviewEvents,
  ReviewRepository,
  Timer,
  TimerHandle,
  WorktreeFileReader,
} from "../ports";

/* ------------------------------------------------------------------ */
/* Clock                                                              */
/* ------------------------------------------------------------------ */

export class ManualClock implements Clock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
  set(iso: string): void {
    this.#now = new Date(iso);
  }
  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

/* ------------------------------------------------------------------ */
/* Timer (for notifyScheduler debounce)                               */
/* ------------------------------------------------------------------ */

/** テスト用の手動タイマー。`advance` で時間を進めるまでコールバックは発火しない */
export class ManualTimer implements Timer {
  #nextId = 1;
  #pending = new Map<number, { at: number; cb: () => void }>();
  #virtualNow = 0;

  setTimeout(cb: () => void, ms: number): TimerHandle {
    const id = this.#nextId++;
    this.#pending.set(id, { at: this.#virtualNow + ms, cb });
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    this.#pending.delete(handle.id);
  }

  /** 仮想時間を進め、期限が来たコールバックを発火する（新たに登録されたものも追いかける） */
  advance(ms: number): void {
    this.#virtualNow += ms;
    for (;;) {
      const due = [...this.#pending.entries()]
        .filter(([, v]) => v.at <= this.#virtualNow)
        .sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) break;
      const [id, entry] = due[0]!;
      this.#pending.delete(id);
      entry.cb();
    }
  }

  pendingCount(): number {
    return this.#pending.size;
  }
}

/* ------------------------------------------------------------------ */
/* ReviewRepository                                                    */
/* ------------------------------------------------------------------ */

export class FakeReviewRepository implements ReviewRepository {
  reviews = new Map<string, Review>();
  repos = new Map<string, RepoRecord>();

  async get(id: string): Promise<Review | null> {
    return this.reviews.get(id) ?? null;
  }

  async list(filter: ListFilter): Promise<Review[]> {
    return [...this.reviews.values()].filter((r) => {
      if (filter.repo && r.repo !== filter.repo) return false;
      if (filter.status && !filter.status.includes(r.status)) return false;
      if (filter.targetKind && r.target.kind !== filter.targetKind) return false;
      if (filter.worktreeRoot && r.worktreeRoot !== filter.worktreeRoot) return false;
      if (filter.commit && !(r.target.kind === "commit" && r.target.hash === filter.commit)) {
        return false;
      }
      if (filter.path && r.path !== filter.path) return false;
      return true;
    });
  }

  async save(review: Review): Promise<void> {
    this.reviews.set(review.id, review);
  }

  async upsertRepo(repo: RepoRecord): Promise<void> {
    const existing = this.repos.get(repo.key);
    this.repos.set(repo.key, existing ? { ...repo, firstSeenAt: existing.firstSeenAt } : repo);
  }

  async getRepo(key: string): Promise<RepoRecord | null> {
    return this.repos.get(key) ?? null;
  }

  async listRepos(): Promise<RepoRecord[]> {
    return [...this.repos.values()];
  }

  async moveRepo(from: string, to: string): Promise<{ repos: number; reviews: number }> {
    if (to !== from && this.repos.has(to)) {
      throw new RepoMoveTargetExistsError(to);
    }
    const rewrite = (value: string): string | null => {
      if (value === from) return to;
      if (value.startsWith(`${from}/`)) return to + value.slice(from.length);
      return null;
    };

    let repoCount = 0;
    for (const [key, record] of [...this.repos.entries()]) {
      const next = rewrite(key);
      if (next === null) continue;
      this.repos.delete(key);
      this.repos.set(next, { ...record, key: next });
      repoCount++;
    }

    let reviewCount = 0;
    for (const review of this.reviews.values()) {
      const nextRepo = rewrite(review.repo);
      const nextWorktreeRoot = rewrite(review.worktreeRoot);
      const nextTarget = review.target.kind === "worktree" ? rewrite(review.target.root) : null;
      if (nextRepo === null && nextWorktreeRoot === null && nextTarget === null) continue;
      this.reviews.set(review.id, {
        ...review,
        repo: nextRepo ?? review.repo,
        worktreeRoot: nextWorktreeRoot ?? review.worktreeRoot,
        target:
          review.target.kind === "worktree"
            ? { kind: "worktree", root: nextTarget ?? review.target.root }
            : review.target,
      });
      reviewCount++;
    }

    return { repos: repoCount, reviews: reviewCount };
  }
}

/* ------------------------------------------------------------------ */
/* GitHistory                                                          */
/* ------------------------------------------------------------------ */

export class FakeGitHistory implements GitHistory {
  heads = new Map<string, string>();
  /** ancestor -> Set<descendant> の到達可能グラフを手で組み立てる */
  ancestryOf = new Map<string, Set<string>>();
  /** null を明示的に入れると revRange が「無効な rev」(F9) を返す */
  ranges = new Map<string, string[] | null>();
  renames = new Map<string, string | null>();

  async headOf(root: string): Promise<string | null> {
    return this.heads.get(root) ?? null;
  }

  async isAncestor(_root: string, ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true;
    return this.ancestryOf.get(ancestor)?.has(descendant) ?? false;
  }

  async revRange(root: string, from: string, to: string): Promise<string[] | null> {
    const key = `${root}:${from}..${to}`;
    return this.ranges.has(key) ? this.ranges.get(key)! : [];
  }

  async renamedPath(root: string, sinceHead: string, path: string): Promise<string | null> {
    return this.renames.get(`${root}:${sinceHead}:${path}`) ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* IntroducingCommitFinder                                             */
/* ------------------------------------------------------------------ */

export class FakeIntroducingCommitFinder implements IntroducingCommitFinder {
  results = new Map<string, string | null>();

  keyFor(root: string, reviewId: string, sinceHead: string): string {
    return `${root}:${reviewId}:${sinceHead}`;
  }

  async find(root: string, review: Review, sinceHead: string): Promise<string | null> {
    const key = this.keyFor(root, review.id, sinceHead);
    return this.results.has(key) ? (this.results.get(key) ?? null) : null;
  }
}

/* ------------------------------------------------------------------ */
/* WorktreeFileReader                                                  */
/* ------------------------------------------------------------------ */

export class FakeWorktreeFileReader implements WorktreeFileReader {
  files = new Map<string, string[] | null>();

  keyFor(root: string, path: string): string {
    return `${root}:${path}`;
  }

  async readLines(root: string, path: string): Promise<string[] | null> {
    const key = this.keyFor(root, path);
    return this.files.has(key) ? this.files.get(key)! : null;
  }
}

/* ------------------------------------------------------------------ */
/* AgentNotifier                                                       */
/* ------------------------------------------------------------------ */

export class FakeAgentNotifier implements AgentNotifier {
  calls: { worktreeRoot: string; commit: string | null; reviewIds: string[] }[] = [];
  nextResult: "sent" | "agent_blocked" | "no_target" = "sent";
  nextPane: string | null = "pane-1";

  async notify(input: {
    worktreeRoot: string;
    commit: string | null;
    reviewIds: string[];
  }): Promise<{ result: "sent" | "agent_blocked" | "no_target"; pane: string | null }> {
    this.calls.push(input);
    return { result: this.nextResult, pane: this.nextResult === "sent" ? this.nextPane : null };
  }
}

/* ------------------------------------------------------------------ */
/* ReviewEvents                                                        */
/* ------------------------------------------------------------------ */

export class FakeReviewEvents implements ReviewEvents {
  events: ReviewEvent[] = [];
  emit(e: ReviewEvent): void {
    this.events.push(e);
  }
}
