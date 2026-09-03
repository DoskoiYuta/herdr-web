import type { MigrationMeta } from "drizzle-orm/migrator";
import type { Db } from "./client";
import { embeddedMigrations } from "./migrations.generated";

/**
 * `drizzle-orm` の `BaseSQLiteDatabase` は `dialect`/`session` を実行時には
 * public フィールドとして持つが（`bun-sqlite/driver.js` の実装参照）、
 * 型定義では `@internal` のコンストラクタ引数としてしか宣言されていない。
 * ファイル同梱のため `readMigrationFiles`（ディスク読み取り必須）を経由しない
 * `dialect.migrate(migrations, session, config)` を直接呼ぶ必要があり、
 * ここだけ内部 API 用の最小限の型で cast する。
 */
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

/**
 * `drizzle/*.sql` を `scripts/embed-migrations.ts` で埋め込んだ
 * `migrations.generated.ts` からマイグレーションを適用する。
 * `bun build --compile` でも動くよう、ファイルシステムを読みに行く
 * `drizzle-orm/bun-sqlite/migrator` の `migrate()` は使わない
 * （内部で `readMigrationFiles` がディスクの `drizzle/` を要求するため）。
 */
export function applyMigrations(db: Db): void {
  const internal = db as unknown as InternalSqliteDb;
  internal.dialect.migrate(embeddedMigrations, internal.session, {
    migrationsTable: "__drizzle_migrations",
  });
}
