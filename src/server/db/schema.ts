import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const repos = sqliteTable("repos", {
  key: text("key").primaryKey(),
  rootCommit: text("root_commit"),
  name: text("name").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    targetKind: text("target_kind").notNull(), // "worktree" | "commit"
    targetValue: text("target_value").notNull(), // worktree の場合は root、commit の場合は hash
    worktreeRoot: text("worktree_root").notNull(),
    path: text("path").notNull(),
    anchor: text("anchor", { mode: "json" }).notNull(),
    createdAtHead: text("created_at_head").notNull(),
    viewedFrom: text("viewed_from").notNull(),
    viewedTo: text("viewed_to").notNull(),
    status: text("status").notNull(), // "open" | "replied" | "resolved" | "outdated"
    notifyState: text("notify_state").notNull().default("none"),
    notifyPane: text("notify_pane"),
    notifyAt: text("notify_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("reviews_repo_status_idx").on(t.repo, t.status),
    index("reviews_target_idx").on(t.targetKind, t.targetValue),
  ],
);

export const reviewEntries = sqliteTable(
  "review_entries",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    author: text("author").notNull(), // "user" | "agent"
    body: text("body").notNull(),
    at: text("at").notNull(),
    agentSession: text("agent_session"),
    draft: integer("draft").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.seq] })],
);

export const asks = sqliteTable(
  "asks",
  {
    id: text("id").primaryKey(),
    repo: text("repo").notNull(),
    worktreeRoot: text("worktree_root").notNull(),
    path: text("path").notNull(),
    anchor: text("anchor", { mode: "json" }).notNull(),
    createdAtHead: text("created_at_head"),
    status: text("status").notNull(), // "open" | "replied" | "resolved" | "outdated"
    session: text("session", { mode: "json" }), // AskSession | null
    lastPromptState: text("last_prompt_state"), // AskPromptState | null
    lastPromptAt: text("last_prompt_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("asks_repo_status_idx").on(t.repo, t.status),
    index("asks_repo_worktree_path_idx").on(t.repo, t.worktreeRoot, t.path),
  ],
);

export const askEntries = sqliteTable(
  "ask_entries",
  {
    askId: text("ask_id")
      .notNull()
      .references(() => asks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    author: text("author").notNull(), // "user" | "agent"
    body: text("body").notNull(),
    at: text("at").notNull(),
    agentSession: text("agent_session"),
  },
  (t) => [primaryKey({ columns: [t.askId, t.seq] })],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    repoKey: text("repo_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("notes_repo_key_idx").on(t.repoKey)],
);

export const paneWorktreeOverrides = sqliteTable("pane_worktree_overrides", {
  paneId: text("pane_id").primaryKey(),
  root: text("root").notNull(),
  observedCwd: text("observed_cwd"),
  setAt: text("set_at").notNull(),
});

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(), // DecisionStatus
    spec: text("spec", { mode: "json" }).notNull(), // DecisionSpec
    answer: text("answer", { mode: "json" }), // DecisionAnswer | null
    paneId: text("pane_id"),
    claudeSessionId: text("claude_session_id"),
    worktreeRoot: text("worktree_root"),
    repoKey: text("repo_key"),
    agent: text("agent"),
    createdAt: text("created_at").notNull(),
    answeredAt: text("answered_at"),
    delivery: text("delivery", { mode: "json" }), // DecisionDelivery | null
  },
  (t) => [
    index("decisions_status_idx").on(t.status),
    index("decisions_worktree_root_idx").on(t.worktreeRoot),
  ],
);
