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
