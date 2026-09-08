import * as v from "valibot";
import type { AskEvent } from "../../contract/ask";
import { ConfigSchema } from "../../contract/config";
import type { DecisionEvent } from "../../contract/decision";
import { createAskRuntime } from "../ask/runtime";
import type { AskSessionLauncher } from "../ask/ports";
import { createFakeAskLauncher } from "../ask/testing/fake-launcher";
import { createDecisionRuntime } from "../decision/runtime";
import type { DecisionNotifier } from "../decision/ports";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import type { FetchRunner } from "../git/fetch";
import { createFakeHerdr, type FakeHerdr } from "../herdr/fake";
import { createHerdrState } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { createInboxService } from "../inbox/service";
import type { ReviewEvent } from "../review/ports";
import { createReviewRuntime } from "../review/runtime";
import { createApp, type AppDeps } from "../app";
import { gitWorktreeResolver } from "../bootstrap";

export type TestAppOptions = {
  allowedRoots?: string[];
  fake?: FakeHerdr;
  resolver?: WorktreeResolver;
  events?: ReviewEvent[];
  fetchRunner?: FetchRunner;
  askLauncher?: AskSessionLauncher;
  askEvents?: AskEvent[];
  decisionNotifier?: DecisionNotifier;
  decisionEvents?: DecisionEvent[];
};

const emptySnapshot = {
  agents: [],
  panes: [],
  tabs: [],
  workspaces: [],
  layouts: [],
  focused_pane_id: null,
  focused_tab_id: null,
  focused_workspace_id: null,
  protocol: 20,
  version: "test",
};

/** ルートテスト用: in-memory sqlite + フェイク herdr で createApp の deps を組む。 */
export function createTestApp(opts: TestAppOptions = {}) {
  const db = openDb(":memory:");
  applyMigrations(db);
  const fake = opts.fake ?? createFakeHerdr(emptySnapshot);
  const state = createHerdrState(
    fake,
    { error() {}, warn() {} },
    { replaySettleMs: 0, replayMaxMs: 0 },
  );
  const resolver = opts.resolver ?? gitWorktreeResolver;
  const events: ReviewEvent[] = opts.events ?? [];
  const review = createReviewRuntime({
    config: v.parse(ConfigSchema, {}),
    db,
    herdr: { state, gateway: fake, resolver },
    onEvent: (e) => events.push(e),
    logger: { info() {}, warn() {}, error() {} },
  });
  const askEvents: AskEvent[] = opts.askEvents ?? [];
  const ask = createAskRuntime({
    config: v.parse(ConfigSchema, {}),
    db,
    launcher: opts.askLauncher ?? createFakeAskLauncher().launcher,
    onEvent: (e) => askEvents.push(e),
    logger: { info() {}, warn() {}, error() {} },
  });
  const decisionEvents: DecisionEvent[] = opts.decisionEvents ?? [];
  const decision = createDecisionRuntime({
    db,
    herdr: { state, gateway: fake, resolver },
    notifier: opts.decisionNotifier,
    onEvent: (e) => decisionEvents.push(e),
    logger: { info() {}, warn() {}, error() {} },
  });
  const inbox = createInboxService({
    reviewRepository: review.repository,
    askRepository: ask.repository,
    decisionRepository: decision.repository,
    state,
    resolver,
  });
  const deps: AppDeps = {
    version: "test",
    herdrStatus: () => fake.status(),
    git: { allowedRoots: opts.allowedRoots ?? [], fetchRunner: opts.fetchRunner },
    clientConfig: () => {
      const c = v.parse(ConfigSchema, {});
      return {
        terminal: c.terminal,
        graphInitialCommits: c.graphInitialCommits,
        ask: {
          agents: c.ask.agents,
          defaultAgent: c.ask.defaultAgent,
          maxSessions: c.ask.maxSessions,
        },
        paths: { config: "/test/config.json", db: "/test/herdr-web.db" },
      };
    },
    review: review.routes,
    repo: review.repoRoutes,
    hw: { state, resolver },
    herdr: { gateway: fake, state, allowedRoots: opts.allowedRoots ?? [] },
    ask: ask.routes,
    decision: { ...decision.routes, buildUrl: (id) => `http://test/decisions/${id}` },
    inbox: { service: inbox },
  };
  return {
    app: createApp(deps),
    fake,
    state,
    review,
    events,
    ask,
    askEvents,
    decision,
    decisionEvents,
    inbox,
    db,
  };
}
