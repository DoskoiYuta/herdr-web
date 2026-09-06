import type { DecisionEvent } from "../../contract/decision";
import { openDb, type Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import type { HerdrGateway } from "../herdr/gateway";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { createLocks, realTimer } from "../review/usecases/locks";
import { createDeliveryScheduler, type DeliveryScheduler } from "./delivery-scheduler";
import { createHerdrDecisionNotifier, createHerdrWhoamiResolver } from "./herdr-adapter";
import type { Clock, DecisionNotifier, Timer, WhoamiResolver } from "./ports";
import { createSqliteDecisionRepository } from "./sqlite-repository";
import { createDecisionService } from "./service";

export type DecisionRuntimeDeps = {
  db: Db;
  herdr?: { state: HerdrStateStore; gateway: HerdrGateway; resolver: WorktreeResolver };
  notifier?: DecisionNotifier;
  whoami?: WhoamiResolver;
  onEvent: (e: DecisionEvent) => void;
  clock?: Clock;
  timer?: Timer;
  isConnected?: () => boolean;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
};

export function openDecisionDb(path: string): Db {
  const db = openDb(path);
  applyMigrations(db);
  return db;
}

/** decision のポートをアダプタで埋めてサービスを組み立てる。routes/decision.ts の deps を返す。 */
export function createDecisionRuntime(deps: DecisionRuntimeDeps) {
  const logger = deps.logger ?? console;
  const clock: Clock = deps.clock ?? { now: () => new Date() };
  const timer = deps.timer ?? realTimer;
  const events = { emit: deps.onEvent };
  const repository = createSqliteDecisionRepository(deps.db);
  const locks = createLocks();

  const notifier: DecisionNotifier =
    deps.notifier ??
    (deps.herdr
      ? createHerdrDecisionNotifier(deps.herdr)
      : { deliver: async () => ({ state: "gone", pane: null }) });
  const whoami: WhoamiResolver =
    deps.whoami ??
    (deps.herdr ? createHerdrWhoamiResolver(deps.herdr) : { resolve: async () => null });
  const isConnected: () => boolean =
    deps.isConnected ?? (deps.herdr ? () => deps.herdr!.gateway.status().connected : () => true);
  const isSettled: () => boolean = deps.herdr ? () => deps.herdr!.state.isSettled() : () => true;

  const delivery: DeliveryScheduler = createDeliveryScheduler({
    repository,
    notifier,
    events,
    clock,
    timer,
    logger,
    locks,
    isConnected,
    isSettled,
  });

  const service = createDecisionService({ repository, whoami, delivery, clock, events, locks });

  return { repository, service, delivery, routes: { repository, service } };
}

export type DecisionRuntime = ReturnType<typeof createDecisionRuntime>;
