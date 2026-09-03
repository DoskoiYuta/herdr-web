import type { MigrationMeta } from "drizzle-orm/migrator";
import { describe, expect, test } from "bun:test";
import { openDb, type Db } from "./client";
import { applyMigrations } from "./migrate";
import { embeddedMigrations } from "./migrations.generated";
import { reviews } from "./schema";

type InternalSqliteDb = {
  dialect: {
    migrate(
      migrations: MigrationMeta[],
      session: unknown,
      config?: { migrationsTable?: string },
    ): void;
  };
  session: unknown;
};

/** Applies only a prefix of `embeddedMigrations`, bypassing `applyMigrations`'s
 * "apply everything" contract — used to simulate an existing on-disk DB that
 * predates a later migration. */
function applyMigrationsSubset(db: Db, migrations: MigrationMeta[]): void {
  const internal = db as unknown as InternalSqliteDb;
  internal.dialect.migrate(migrations, internal.session, {
    migrationsTable: "__drizzle_migrations",
  });
}

describe("migration upgrade path", () => {
  // Missing-test (c): a DB that only has migration 0000 applied (no notify_*
  // columns yet — the state before the notify feature shipped) must, once the
  // rest of applyMigrations runs, backfill existing rows with notify.state ===
  // "none" (the DEFAULT 'none' the 0001 migration's ALTER TABLE specifies) —
  // not "pending", and not crash/lose the row.
  test("a row inserted under migration 0000 only reads back notify.state === 'none' after the rest of applyMigrations runs", () => {
    const db = openDb(":memory:");
    applyMigrationsSubset(db, embeddedMigrations.slice(0, 1));

    // At this point `reviews` has no notify_state/notify_pane/notify_at
    // columns yet, so this must be raw SQL, not the drizzle query builder
    // (whose types assume the full current schema).
    const sqlite = (db as unknown as { session: { client: { exec: (sql: string) => void } } })
      .session.client;
    sqlite.exec(`
      INSERT INTO reviews (
        id, repo, target_kind, target_value, worktree_root, path, anchor,
        created_at_head, viewed_from, viewed_to, status, created_at, updated_at
      ) VALUES (
        'r1', '/repo/.git', 'worktree', '/repo', '/repo', 'a.ts',
        '{"side":"new","line":"x","before":[],"after":[],"lineHint":1,"hash":"h"}',
        'head1', 'WORKTREE', 'WORKTREE', 'open',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);

    // Now catch the DB up fully — this is what `openReviewDb` does on every
    // real startup, including against an existing on-disk DB from before the
    // notify feature shipped.
    applyMigrations(db);

    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notifyState).toBe("none");
    expect(rows[0]?.notifyPane).toBeNull();
    expect(rows[0]?.notifyAt).toBeNull();
  });
});
