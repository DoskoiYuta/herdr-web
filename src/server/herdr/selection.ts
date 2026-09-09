import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { workspaceWorktreeSelections } from "../db/schema";
import type { SelectionRepository } from "./state";

/** SQLite-backed `SelectionRepository` (ui-redesign.md §10) — persists `HerdrState.selections`. */
export function createSqliteSelectionRepository(db: Db): SelectionRepository {
  return {
    async list() {
      const rows = await db.select().from(workspaceWorktreeSelections);
      return rows.map((row) => ({
        workspaceId: row.workspaceId,
        repoKey: row.repoKey,
        worktreeRoot: row.worktreeRoot,
        subRepoId: row.subRepoId,
        subWorktreeRoot: row.subWorktreeRoot,
        updatedAt: row.updatedAt,
      }));
    },

    async set(selection) {
      await db
        .insert(workspaceWorktreeSelections)
        .values(selection)
        .onConflictDoUpdate({
          target: [workspaceWorktreeSelections.workspaceId, workspaceWorktreeSelections.repoKey],
          set: {
            worktreeRoot: selection.worktreeRoot,
            subRepoId: selection.subRepoId,
            subWorktreeRoot: selection.subWorktreeRoot,
            updatedAt: selection.updatedAt,
          },
        });
    },

    async delete(workspaceId, repoKey) {
      await db
        .delete(workspaceWorktreeSelections)
        .where(
          and(
            eq(workspaceWorktreeSelections.workspaceId, workspaceId),
            eq(workspaceWorktreeSelections.repoKey, repoKey),
          ),
        );
    },

    async deleteByWorkspace(workspaceId) {
      await db
        .delete(workspaceWorktreeSelections)
        .where(eq(workspaceWorktreeSelections.workspaceId, workspaceId));
    },
  };
}
