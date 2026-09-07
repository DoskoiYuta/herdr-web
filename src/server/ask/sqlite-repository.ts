import { and, asc, eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { AskSessionSchema, type Ask, type AskSession, type AskStatus } from "../../contract/ask";
import type { Db } from "../db/client";
import { askEntries, asks } from "../db/schema";
import type { AskListFilter, AskRepository } from "./ports";

type AskRow = typeof asks.$inferSelect;
type AskEntryRow = typeof askEntries.$inferSelect;

/** `AskSessionSchema` を通して読む — 列追加前の行には `agent` キー自体が無く、
 * それを生キャストで返すと `undefined` のまま漏れる（表示側は `null` を前提に
 * `?? "不明"` している）。不正な JSON なら null 扱い（`session: null` と同じ）。 */
function parseSession(raw: unknown): AskSession | null {
  if (raw == null) return null;
  const result = v.safeParse(AskSessionSchema, raw);
  return result.success ? result.output : null;
}

function rowToAsk(row: AskRow, entryRows: AskEntryRow[]): Ask {
  return {
    id: row.id,
    repo: row.repo,
    worktreeRoot: row.worktreeRoot,
    path: row.path,
    anchor: row.anchor as Ask["anchor"],
    createdAtHead: row.createdAtHead,
    status: row.status as AskStatus,
    session: parseSession(row.session),
    thread: entryRows
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({
        seq: e.seq,
        author: e.author as "user" | "agent",
        body: e.body,
        at: e.at,
        agentSession: e.agentSession,
      })),
    lastPrompt:
      row.lastPromptState && row.lastPromptAt
        ? {
            state: row.lastPromptState as NonNullable<Ask["lastPrompt"]>["state"],
            at: row.lastPromptAt,
          }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function askToRow(ask: Ask): AskRow {
  return {
    id: ask.id,
    repo: ask.repo,
    worktreeRoot: ask.worktreeRoot,
    path: ask.path,
    anchor: ask.anchor,
    createdAtHead: ask.createdAtHead,
    status: ask.status,
    session: ask.session,
    lastPromptState: ask.lastPrompt?.state ?? null,
    lastPromptAt: ask.lastPrompt?.at ?? null,
    createdAt: ask.createdAt,
    updatedAt: ask.updatedAt,
  };
}

export function createSqliteAskRepository(db: Db): AskRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(asks).where(eq(asks.id, id));
      if (!row) return null;
      const entryRows = await db
        .select()
        .from(askEntries)
        .where(eq(askEntries.askId, id))
        .orderBy(asc(askEntries.seq));
      return rowToAsk(row, entryRows);
    },

    async list(filter: AskListFilter) {
      const conditions = [];
      if (filter.repo) conditions.push(eq(asks.repo, filter.repo));
      if (filter.worktreeRoot) conditions.push(eq(asks.worktreeRoot, filter.worktreeRoot));
      if (filter.status && filter.status.length > 0) {
        conditions.push(inArray(asks.status, filter.status));
      }
      if (filter.path) conditions.push(eq(asks.path, filter.path));

      const rows = await db
        .select()
        .from(asks)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const entryRows = await db
        .select()
        .from(askEntries)
        .where(inArray(askEntries.askId, ids))
        .orderBy(asc(askEntries.seq));
      const entriesByAsk = new Map<string, AskEntryRow[]>();
      for (const e of entryRows) {
        const arr = entriesByAsk.get(e.askId) ?? [];
        arr.push(e);
        entriesByAsk.set(e.askId, arr);
      }
      return rows.map((row) => rowToAsk(row, entriesByAsk.get(row.id) ?? []));
    },

    async save(ask: Ask) {
      const row = askToRow(ask);
      // review の sqlite-repository と同じ理由: 行とスレッドを 1 トランザクションで
      // 置き換える（bun:sqlite の transaction コールバックは同期でなければならない
      // ため .run() を使う）。
      db.transaction((tx) => {
        tx.insert(asks).values(row).onConflictDoUpdate({ target: asks.id, set: row }).run();
        tx.delete(askEntries).where(eq(askEntries.askId, ask.id)).run();
        if (ask.thread.length > 0) {
          tx.insert(askEntries)
            .values(
              ask.thread.map((entry) => ({
                askId: ask.id,
                seq: entry.seq,
                author: entry.author,
                body: entry.body,
                at: entry.at,
                agentSession: entry.agentSession,
              })),
            )
            .run();
        }
      });
    },
  };
}
