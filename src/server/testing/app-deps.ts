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
import { buildAllowedHosts } from "../hostGuard";
import { createFakeHerdr, type FakeHerdr } from "../herdr/fake";
import type { SubRepoLike, WorktreeEntryLike } from "../herdr/pane-worktree";
import { createSqliteSelectionRepository } from "../herdr/selection";
import { createHerdrState, type SelectionRepository, type ToolTabRepository } from "../herdr/state";
import { createSqliteToolTabRepository } from "../herdr/tool-tab";
import type { WorktreeResolver } from "../herdr/tree";
import { listSubRepos } from "../git/subrepos";
import { listWorktrees } from "../git/worktrees";
import { createInboxService } from "../inbox/service";
import { createNotesService } from "../notes/service";
import { createSqliteNotesRepository } from "../notes/sqlite-repository";
import type { ReviewEvent } from "../review/ports";
import { createReviewRuntime } from "../review/runtime";
import { createApp, type AppDeps } from "../app";
import { gitWorktreeResolver } from "../bootstrap";

export type TestAppOptions = {
  allowedRoots?: string[];
  /** DNS リバインディング対策の許可ホスト名。既定は loopback のみ。 */
  allowedHosts?: string[];
  fake?: FakeHerdr;
  resolver?: WorktreeResolver;
  listWorktrees?: (repoPath: string) => Promise<WorktreeEntryLike[]>;
  listSubRepos?: (root: string) => Promise<SubRepoLike[]>;
  /** Override the selection persistence port (e.g. to simulate a SQLite write failure). */
  selectionRepository?: SelectionRepository;
  /** Override the tool-tab persistence port (e.g. to simulate a SQLite write failure). */
  toolTabRepository?: ToolTabRepository;
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
    opts.selectionRepository ?? createSqliteSelectionRepository(db),
    opts.toolTabRepository ?? createSqliteToolTabRepository(db),
  );
  const resolver = opts.resolver ?? gitWorktreeResolver;
  const listWorktreesFn = opts.listWorktrees ?? listWorktrees;
  const listSubReposFn = opts.listSubRepos ?? listSubRepos;
  const herdrDeps = {
    state,
    gateway: fake,
    resolver,
    listWorktrees: listWorktreesFn,
    listSubRepos: listSubReposFn,
  };
  const events: ReviewEvent[] = opts.events ?? [];
  const review = createReviewRuntime({
    config: v.parse(ConfigSchema, {}),
    db,
    herdr: herdrDeps,
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
    herdr: herdrDeps,
    notifier: opts.decisionNotifier,
    onEvent: (e) => decisionEvents.push(e),
    logger: { info() {}, warn() {}, error() {} },
  });
  const notesRepository = createSqliteNotesRepository(db);
  const notes = createNotesService({
    repository: notesRepository,
    clock: { now: () => new Date() },
  });
  const inbox = createInboxService({
    reviewRepository: review.repository,
    askRepository: ask.repository,
    decisionRepository: decision.repository,
    state,
    resolver,
    listWorktrees: listWorktreesFn,
    listSubRepos: listSubReposFn,
  });
  const deps: AppDeps = {
    version: "test",
    allowedHosts: buildAllowedHosts({ host: "127.0.0.1", allowedHosts: opts.allowedHosts ?? [] }),
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
    hw: { state, resolver, listWorktrees: listWorktreesFn, listSubRepos: listSubReposFn },
    herdr: {
      gateway: fake,
      state,
      resolver,
      listWorktrees: listWorktreesFn,
      listSubRepos: listSubReposFn,
      allowedRoots: opts.allowedRoots ?? [],
    },
    ask: ask.routes,
    decision: { ...decision.routes, buildUrl: (id) => `http://test/decisions/${id}` },
    notes: { service: notes, repository: notesRepository },
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
    notes,
    inbox,
    db,
  };
}
