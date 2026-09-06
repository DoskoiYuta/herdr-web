import { and, eq, inArray } from "drizzle-orm";
import type {
  Decision,
  DecisionAnswer,
  DecisionDelivery,
  DecisionSpec,
  DecisionStatus,
} from "../../contract/decision";
import type { Db } from "../db/client";
import { decisions } from "../db/schema";
import type { DecisionListFilter, DecisionRepository } from "./ports";

type DecisionRow = typeof decisions.$inferSelect;

function rowToDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    status: row.status as DecisionStatus,
    spec: row.spec as DecisionSpec,
    answer: row.answer as DecisionAnswer | null,
    paneId: row.paneId,
    claudeSessionId: row.claudeSessionId,
    worktreeRoot: row.worktreeRoot,
    repoKey: row.repoKey,
    agent: row.agent,
    createdAt: row.createdAt,
    answeredAt: row.answeredAt,
    delivery: row.delivery as DecisionDelivery | null,
  };
}

function decisionToRow(decision: Decision): DecisionRow {
  return { ...decision };
}

export function createSqliteDecisionRepository(db: Db): DecisionRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(decisions).where(eq(decisions.id, id));
      return row ? rowToDecision(row) : null;
    },

    async list(filter: DecisionListFilter) {
      const conditions = [];
      if (filter.status && filter.status.length > 0) {
        conditions.push(inArray(decisions.status, filter.status));
      }
      if (filter.worktreeRoot) conditions.push(eq(decisions.worktreeRoot, filter.worktreeRoot));

      const rows = await db
        .select()
        .from(decisions)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      return rows.map(rowToDecision);
    },

    async save(decision: Decision) {
      const row = decisionToRow(decision);
      await db.insert(decisions).values(row).onConflictDoUpdate({ target: decisions.id, set: row });
    },
  };
}
