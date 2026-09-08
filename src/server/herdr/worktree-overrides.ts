import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { paneWorktreeOverrides } from "../db/schema";
import type { PaneWorktreeOverrideRepository } from "./state";

export function createSqlitePaneWorktreeOverrideRepository(db: Db): PaneWorktreeOverrideRepository {
  return {
    async list() {
      const rows = await db.select().from(paneWorktreeOverrides);
      return rows.map((row) => ({
        paneId: row.paneId,
        root: row.root,
        observedCwd: row.observedCwd,
        setAt: row.setAt,
      }));
    },

    async set(override) {
      await db
        .insert(paneWorktreeOverrides)
        .values({
          paneId: override.paneId,
          root: override.root,
          observedCwd: override.observedCwd,
          setAt: override.setAt,
        })
        .onConflictDoUpdate({
          target: paneWorktreeOverrides.paneId,
          set: {
            root: override.root,
            observedCwd: override.observedCwd,
            setAt: override.setAt,
          },
        });
    },

    async delete(paneId) {
      await db.delete(paneWorktreeOverrides).where(eq(paneWorktreeOverrides.paneId, paneId));
    },
  };
}
