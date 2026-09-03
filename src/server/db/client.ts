import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** `:memory:` またはファイルパスで SQLite を開き、WAL + 外部キー制約を有効にする */
export function openDb(path: string): Db {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}
