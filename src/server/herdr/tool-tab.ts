import { eq } from "drizzle-orm";
import type { ToolTab } from "../../contract/tool-tab";
import type { Db } from "../db/client";
import { workspaceToolTabs } from "../db/schema";
import type { ToolTabRepository } from "./state";

/** SQLite-backed `ToolTabRepository` — persists `HerdrState.toolTabs`. */
export function createSqliteToolTabRepository(db: Db): ToolTabRepository {
  return {
    async list() {
      const rows = await db.select().from(workspaceToolTabs);
      return rows.map((row) => ({
        workspaceId: row.workspaceId,
        tab: row.tab as ToolTab,
        updatedAt: row.updatedAt,
      }));
    },

    async set(toolTab) {
      await db
        .insert(workspaceToolTabs)
        .values(toolTab)
        .onConflictDoUpdate({
          target: workspaceToolTabs.workspaceId,
          set: { tab: toolTab.tab, updatedAt: toolTab.updatedAt },
        });
    },

    async deleteByWorkspace(workspaceId) {
      await db.delete(workspaceToolTabs).where(eq(workspaceToolTabs.workspaceId, workspaceId));
    },
  };
}
