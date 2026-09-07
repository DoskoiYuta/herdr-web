import type { Config } from "../../contract/config";
import type { AskEvent } from "../../contract/ask";
import type { Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { openDb } from "../db/client";
import type { Clock } from "../review/domain/clock";
import { createSqliteAskRepository } from "./sqlite-repository";
import { createAskService } from "./service";
import type { AskSessionLauncher } from "./ports";

export type AskRuntimeDeps = {
  config: Pick<Config, "ask">;
  db: Db;
  launcher: AskSessionLauncher;
  onEvent: (e: AskEvent) => void;
  clock?: Clock;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
};

export function openAskDb(path: string): Db {
  const db = openDb(path);
  applyMigrations(db);
  return db;
}

/** ask のポートをアダプタで埋めてサービスを組み立てる。routes/ask.ts の deps を返す。 */
export function createAskRuntime(deps: AskRuntimeDeps) {
  const clock: Clock = deps.clock ?? { now: () => new Date() };
  const repository = createSqliteAskRepository(deps.db);
  const service = createAskService({
    repository,
    launcher: deps.launcher,
    clock,
    events: { emit: deps.onEvent },
    template: deps.config.ask.template,
    replyTemplate: deps.config.ask.replyTemplate,
    maxSessions: deps.config.ask.maxSessions,
    agents: deps.config.ask.agents,
    defaultAgent: deps.config.ask.defaultAgent,
  });

  return { repository, service, routes: { repository, service } };
}

export type AskRuntime = ReturnType<typeof createAskRuntime>;
