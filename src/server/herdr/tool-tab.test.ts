import { describe, expect, test } from "bun:test";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { createSqliteToolTabRepository } from "./tool-tab";

function makeRepo() {
  const db = openDb(":memory:");
  applyMigrations(db);
  return createSqliteToolTabRepository(db);
}

const base = { workspaceId: "w1", tab: "notes" as const, updatedAt: "2026-01-01T00:00:00.000Z" };

describe("createSqliteToolTabRepository", () => {
  test("set() then list() then deleteByWorkspace() round-trips a saved tab", async () => {
    const repo = makeRepo();
    await repo.set(base);
    expect(await repo.list()).toEqual([base]);

    await repo.deleteByWorkspace(base.workspaceId);
    expect(await repo.list()).toEqual([]);
  });

  test("set() overwrites the previous tab for the same workspace", async () => {
    const repo = makeRepo();
    await repo.set(base);
    const updated = { ...base, tab: "graph" as const, updatedAt: "2026-01-02T00:00:00.000Z" };
    await repo.set(updated);
    expect(await repo.list()).toEqual([updated]);
  });
});
