import * as v from "valibot";
import { ConfigSchema } from "../../contract/config";
import { openDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import type { FetchRunner } from "../git/fetch";
import { createFakeHerdr, type FakeHerdr } from "../herdr/fake";
import { createHerdrState } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
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
  const state = createHerdrState(fake, { error() {}, warn() {} });
  const resolver = opts.resolver ?? gitWorktreeResolver;
  const events: ReviewEvent[] = opts.events ?? [];
  const review = createReviewRuntime({
    config: v.parse(ConfigSchema, {}),
    db,
    herdr: { state, gateway: fake, resolver },
    onEvent: (e) => events.push(e),
    logger: { info() {}, warn() {}, error() {} },
  });
  const deps: AppDeps = {
    version: "test",
    herdrStatus: () => fake.status(),
    git: { allowedRoots: opts.allowedRoots ?? [], fetchRunner: opts.fetchRunner },
    clientConfig: () => {
      const c = v.parse(ConfigSchema, {});
      return { terminal: c.terminal, graphInitialCommits: c.graphInitialCommits };
    },
    review: review.routes,
    repo: review.repoRoutes,
    hw: { state, resolver },
    herdr: { gateway: fake, allowedRoots: opts.allowedRoots ?? [] },
  };
  return { app: createApp(deps), fake, state, review, events, db };
}
