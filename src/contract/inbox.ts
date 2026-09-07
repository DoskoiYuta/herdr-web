import * as v from "valibot";

/**
 * `GET /api/inbox?worktree=` — worktree 横断で人間の注意が必要なものを 1 か所に
 * 集める（docs/ui-redesign.md §4.2 D1, §5.4 Inbox）。対応すると消えるものだけを
 * 出し、履歴は持たない。判断依頼（Decision）自体は対象に入れず、Decision の
 * 配達が未達のものだけを `undelivered` セクションに出す。
 */

export const InboxSectionSchema = v.picklist(["undelivered", "replied", "unsent", "blocked"]);
export type InboxSection = v.InferOutput<typeof InboxSectionSchema>;

/** Review notify / Decision delivery / Ask lastPrompt の生の状態をそのまま載せる。
 * 表示語への写像（6 語 + canResend）は web 側 `statusVocab.ts` が行う。 */
export const InboxDeliveryStateSchema = v.picklist([
  "pending",
  "sent",
  "agent_blocked",
  "no_target",
  "unknown",
  "none",
  "gone",
  "failed",
]);
export type InboxDeliveryState = v.InferOutput<typeof InboxDeliveryStateSchema>;

export const InboxLocationSchema = v.object({
  path: v.string(),
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export type InboxLocation = v.InferOutput<typeof InboxLocationSchema>;

export const InboxUndeliveredItemSchema = v.object({
  section: v.literal("undelivered"),
  kind: v.picklist(["review", "ask", "decision"]),
  id: v.string(),
  title: v.string(),
  detail: v.string(),
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  at: v.string(),
  delivery: v.object({ state: InboxDeliveryStateSchema, canResend: v.boolean() }),
  location: v.optional(InboxLocationSchema),
});
export type InboxUndeliveredItem = v.InferOutput<typeof InboxUndeliveredItemSchema>;

export const InboxRepliedItemSchema = v.object({
  section: v.literal("replied"),
  kind: v.picklist(["review", "ask"]),
  id: v.string(),
  title: v.string(),
  /** 最後の agent メッセージ先頭 120 文字 */
  excerpt: v.string(),
  worktreeRoot: v.string(),
  repoKey: v.string(),
  agent: v.nullable(v.string()),
  at: v.string(),
  location: InboxLocationSchema,
});
export type InboxRepliedItem = v.InferOutput<typeof InboxRepliedItemSchema>;

export const InboxUnsentItemSchema = v.object({
  section: v.literal("unsent"),
  kind: v.literal("review"),
  worktreeRoot: v.string(),
  repoKey: v.string(),
  count: v.number(),
  at: v.string(),
});
export type InboxUnsentItem = v.InferOutput<typeof InboxUnsentItemSchema>;

export const InboxBlockedItemSchema = v.object({
  section: v.literal("blocked"),
  kind: v.literal("agent"),
  paneId: v.string(),
  agent: v.nullable(v.string()),
  label: v.nullable(v.string()),
  workspaceLabel: v.nullable(v.string()),
  tabLabel: v.nullable(v.string()),
  worktreeRoot: v.nullable(v.string()),
  /** herdr は blocked になった時刻を持たない */
  at: v.nullable(v.string()),
});
export type InboxBlockedItem = v.InferOutput<typeof InboxBlockedItemSchema>;

export const InboxItemSchema = v.variant("section", [
  InboxUndeliveredItemSchema,
  InboxRepliedItemSchema,
  InboxUnsentItemSchema,
  InboxBlockedItemSchema,
]);
export type InboxItem = v.InferOutput<typeof InboxItemSchema>;

export const InboxCountsSchema = v.object({
  total: v.number(),
  bySection: v.record(InboxSectionSchema, v.number()),
});
export type InboxCounts = v.InferOutput<typeof InboxCountsSchema>;

export const InboxResponseSchema = v.object({
  /** セクション順（届いていない通知 → 返信が届いた → 送信待ち → 入力待ちのエージェント）・
   * 各セクション内は新しい順 */
  items: v.array(InboxItemSchema),
  counts: InboxCountsSchema,
});
export type InboxResponse = v.InferOutput<typeof InboxResponseSchema>;

export const InboxQuerySchema = v.object({
  worktree: v.optional(v.string()),
});
export type InboxQuery = v.InferOutput<typeof InboxQuerySchema>;
