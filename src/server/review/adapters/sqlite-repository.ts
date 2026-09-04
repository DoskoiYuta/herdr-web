import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  Anchor,
  NotifyState,
  RepoRecord,
  Review,
  ReviewStatus,
} from "../../../contract/review";
import type { Db } from "../../db/client";
import { repos, reviewEntries, reviews } from "../../db/schema";
import { RepoMoveTargetExistsError, type ListFilter, type ReviewRepository } from "../ports";

type ReviewRow = typeof reviews.$inferSelect;
type ReviewEntryRow = typeof reviewEntries.$inferSelect;

/**
 * この変更より前に書かれた行は `anchor` JSON に `line: string` を持ち、`lines` を持たない。
 * SQL 側の一括マイグレーションはせず、読み出し時にその場で `{ lines: [line] }` へ寄せる。
 */
function normalizeAnchor(raw: unknown): Anchor {
  const a = raw as Anchor & { line?: string };
  if (Array.isArray(a.lines)) return a as Anchor;
  const { line, ...rest } = a;
  return { ...rest, lines: [line ?? ""] } as Anchor;
}

function rowsToReview(row: ReviewRow, entryRows: ReviewEntryRow[]): Review {
  const target =
    row.targetKind === "worktree"
      ? ({ kind: "worktree", root: row.targetValue } as const)
      : ({ kind: "commit", hash: row.targetValue } as const);
  return {
    id: row.id,
    repo: row.repo,
    target,
    worktreeRoot: row.worktreeRoot,
    path: row.path,
    anchor: normalizeAnchor(row.anchor),
    createdAtHead: row.createdAtHead,
    viewedAs: { from: row.viewedFrom, to: row.viewedTo },
    status: row.status as ReviewStatus,
    thread: entryRows
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        seq: e.seq,
        author: e.author as "user" | "agent",
        body: e.body,
        at: e.at,
        agentSession: e.agentSession,
        draft: Boolean(e.draft),
      })),
    notify: {
      state: row.notifyState as NotifyState,
      pane: row.notifyPane,
      at: row.notifyAt,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reviewToRow(review: Review): ReviewRow {
  return {
    id: review.id,
    repo: review.repo,
    targetKind: review.target.kind,
    targetValue: review.target.kind === "worktree" ? review.target.root : review.target.hash,
    worktreeRoot: review.worktreeRoot,
    path: review.path,
    anchor: review.anchor,
    createdAtHead: review.createdAtHead,
    viewedFrom: review.viewedAs.from,
    viewedTo: review.viewedAs.to,
    status: review.status,
    notifyState: review.notify.state,
    notifyPane: review.notify.pane,
    notifyAt: review.notify.at,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/** `from` と厳密一致、または `from + "/"` から始まる場合のみ書き換える（前方一致・境界厳守） */
function rewritePrefix(value: string, from: string, to: string): string | null {
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return to + value.slice(from.length);
  return null;
}

export function createSqliteReviewRepository(db: Db): ReviewRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
      if (!row) return null;
      const entryRows = await db
        .select()
        .from(reviewEntries)
        .where(eq(reviewEntries.reviewId, id))
        .orderBy(asc(reviewEntries.seq));
      return rowsToReview(row, entryRows);
    },

    async list(filter: ListFilter) {
      const conditions = [];
      if (filter.repo) conditions.push(eq(reviews.repo, filter.repo));
      if (filter.status && filter.status.length > 0) {
        conditions.push(inArray(reviews.status, filter.status));
      }
      if (filter.targetKind) conditions.push(eq(reviews.targetKind, filter.targetKind));
      if (filter.worktreeRoot) conditions.push(eq(reviews.worktreeRoot, filter.worktreeRoot));
      if (filter.commit) {
        conditions.push(eq(reviews.targetKind, "commit"));
        conditions.push(eq(reviews.targetValue, filter.commit));
      }
      if (filter.path) conditions.push(eq(reviews.path, filter.path));

      const rows = await db
        .select()
        .from(reviews)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const entryRows = await db
        .select()
        .from(reviewEntries)
        .where(inArray(reviewEntries.reviewId, ids))
        .orderBy(asc(reviewEntries.seq));
      const entriesByReview = new Map<string, ReviewEntryRow[]>();
      for (const e of entryRows) {
        const arr = entriesByReview.get(e.reviewId) ?? [];
        arr.push(e);
        entriesByReview.set(e.reviewId, arr);
      }
      return rows.map((row) => rowsToReview(row, entriesByReview.get(row.id) ?? []));
    },

    async save(review: Review) {
      const row = reviewToRow(review);
      // F4a: the review row and its thread entries must be replaced atomically —
      // a concurrent reader must never observe the new row with the old thread
      // (or vice versa). `db.transaction` on bun:sqlite requires a *synchronous*
      // callback (its native wrapper runs BEGIN/callback/COMMIT with no await in
      // between — see sqlite-repository.test.ts), so every statement inside uses
      // the sync `.run()` form rather than `await`ing the query builder.
      db.transaction((tx) => {
        tx.insert(reviews).values(row).onConflictDoUpdate({ target: reviews.id, set: row }).run();
        tx.delete(reviewEntries).where(eq(reviewEntries.reviewId, review.id)).run();
        if (review.thread.length > 0) {
          tx.insert(reviewEntries)
            .values(
              review.thread.map((entry) => ({
                reviewId: review.id,
                seq: entry.seq,
                author: entry.author,
                body: entry.body,
                at: entry.at,
                agentSession: entry.agentSession,
                draft: entry.draft ? 1 : 0,
              })),
            )
            .run();
        }
      });
    },

    async delete(id) {
      // review_entries は ON DELETE CASCADE (schema.ts) なので reviews の削除だけでよい。
      await db.delete(reviews).where(eq(reviews.id, id));
    },

    async updateNotify(id, notify) {
      // item 1: only the three notify columns — never the whole row — so a
      // concurrent reply/reanchor's write can never be clobbered by a stale
      // in-memory review snapshot the scheduler is holding.
      db.transaction((tx) => {
        tx.update(reviews)
          .set({ notifyState: notify.state, notifyPane: notify.pane, notifyAt: notify.at })
          .where(eq(reviews.id, id))
          .run();
      });
    },

    async upsertRepo(repo: RepoRecord) {
      await db
        .insert(repos)
        .values(repo)
        .onConflictDoUpdate({
          target: repos.key,
          set: { rootCommit: repo.rootCommit, name: repo.name, lastSeenAt: repo.lastSeenAt },
        });
    },

    async getRepo(key: string) {
      const [row] = await db.select().from(repos).where(eq(repos.key, key));
      return row ?? null;
    },

    async listRepos() {
      return db.select().from(repos).orderBy(asc(repos.key));
    },

    async moveRepo(from: string, to: string) {
      // F8: atomic (single transaction) and safe — `to` must not already be a
      // registered repo key (would silently merge two repos' reviews).
      return db.transaction((tx) => {
        if (to !== from) {
          const existing = tx.select().from(repos).where(eq(repos.key, to)).all();
          if (existing.length > 0) throw new RepoMoveTargetExistsError(to);
        }

        let repoCount = 0;
        const allRepos = tx.select().from(repos).all();
        for (const r of allRepos) {
          const next = rewritePrefix(r.key, from, to);
          if (next === null) continue;
          tx.update(repos).set({ key: next }).where(eq(repos.key, r.key)).run();
          repoCount++;
        }

        let reviewCount = 0;
        const allReviews = tx.select().from(reviews).all();
        for (const r of allReviews) {
          const nextRepo = rewritePrefix(r.repo, from, to);
          const nextWorktreeRoot = rewritePrefix(r.worktreeRoot, from, to);
          const nextTargetValue =
            r.targetKind === "worktree" ? rewritePrefix(r.targetValue, from, to) : null;

          if (nextRepo === null && nextWorktreeRoot === null && nextTargetValue === null) continue;

          tx.update(reviews)
            .set({
              repo: nextRepo ?? r.repo,
              worktreeRoot: nextWorktreeRoot ?? r.worktreeRoot,
              targetValue: nextTargetValue ?? r.targetValue,
            })
            .where(eq(reviews.id, r.id))
            .run();
          reviewCount++;
        }

        return { repos: repoCount, reviews: reviewCount };
      });
    },
  };
}
