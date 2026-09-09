import { describe, expect, test } from "bun:test";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { createSqliteSelectionRepository } from "./selection";

function makeRepo() {
  const db = openDb(":memory:");
  applyMigrations(db);
  return createSqliteSelectionRepository(db);
}

const base = {
  workspaceId: "w1",
  repoKey: "/repo/.git",
  worktreeRoot: "/repo",
  subRepoId: null,
  subWorktreeRoot: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createSqliteSelectionRepository", () => {
  test("a saved selection round-trips through list()", async () => {
    const repo = makeRepo();
    await repo.set(base);
    expect(await repo.list()).toEqual([base]);
  });

  test("set() overwrites the selection for the same (workspaceId, repoKey)", async () => {
    const repo = makeRepo();
    await repo.set(base);
    const updated = { ...base, worktreeRoot: "/repo-other", updatedAt: "2026-01-02T00:00:00.000Z" };
    await repo.set(updated);
    expect(await repo.list()).toEqual([updated]);
  });

  test("delete() removes only the matching (workspaceId, repoKey)", async () => {
    const repo = makeRepo();
    await repo.set(base);
    await repo.set({ ...base, repoKey: "/other/.git" });
    await repo.delete(base.workspaceId, base.repoKey);
    expect(await repo.list()).toEqual([{ ...base, repoKey: "/other/.git" }]);
  });

  test("deleteByWorkspace() removes every repoKey for that workspace only", async () => {
    const repo = makeRepo();
    await repo.set(base);
    await repo.set({ ...base, repoKey: "/other/.git" });
    await repo.set({ ...base, workspaceId: "w2" });
    await repo.deleteByWorkspace("w1");
    expect(await repo.list()).toEqual([{ ...base, workspaceId: "w2" }]);
  });
});
