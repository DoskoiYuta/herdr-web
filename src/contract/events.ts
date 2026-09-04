/**
 * Sidebar row types (plan.md §6.6, §9.2) and the `/ws/events` message schemas
 * (plan.md §9.2). Server -> client and client -> server messages both live here
 * so `src/web` (contract-only) and `src/server/events` share one definition.
 */
import * as v from "valibot";
import { AgentSessionInfoSchema, AgentStatusSchema } from "./herdr";
import { ReviewSchema } from "./review";

// ---------------------------------------------------------------------------
// Sidebar tree row types (plan.md §6.6 / §9.2 Repo[])
// ---------------------------------------------------------------------------

export const PaneRowSchema = v.object({
  paneId: v.string(),
  workspaceId: v.string(),
  workspaceLabel: v.nullable(v.string()),
  tabId: v.string(),
  tabLabel: v.nullable(v.string()),
  label: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  agentStatus: AgentStatusSchema,
  terminalTitleStripped: v.nullable(v.string()),
  focused: v.boolean(),
  cwd: v.nullable(v.string()),
  foregroundCwd: v.nullable(v.string()),
});
export type PaneRow = v.InferOutput<typeof PaneRowSchema>;

export const WorktreeRowSchema = v.object({
  root: v.string(),
  branch: v.nullable(v.string()),
  isMain: v.boolean(),
  panes: v.array(PaneRowSchema),
});
export type WorktreeRow = v.InferOutput<typeof WorktreeRowSchema>;

export const RepoCountsSchema = v.object({ blocked: v.number(), done: v.number() });
export type RepoCounts = v.InferOutput<typeof RepoCountsSchema>;

/** `key` is `git rev-parse --git-common-dir` (absolute), or the sentinel `"other"` group. */
export const RepoSchema = v.object({
  key: v.string(),
  name: v.string(),
  worktrees: v.array(WorktreeRowSchema),
  counts: RepoCountsSchema,
});
export type Repo = v.InferOutput<typeof RepoSchema>;

/** `workspace > tab > pane` view (plan.md §6.6 "表示モード: workspace"). */
export const TabNodeSchema = v.object({
  tabId: v.string(),
  label: v.string(),
  panes: v.array(PaneRowSchema),
});
export type TabNode = v.InferOutput<typeof TabNodeSchema>;

export const WorkspaceNodeSchema = v.object({
  workspaceId: v.string(),
  label: v.string(),
  tabs: v.array(TabNodeSchema),
});
export type WorkspaceNode = v.InferOutput<typeof WorkspaceNodeSchema>;

// ---------------------------------------------------------------------------
// /ws/events: server -> client
// ---------------------------------------------------------------------------

export const TreeMessageSchema = v.object({ type: v.literal("tree"), repos: v.array(RepoSchema) });
export type TreeMessage = v.InferOutput<typeof TreeMessageSchema>;

export const PaneUpdatedMessageSchema = v.object({
  type: v.literal("pane-updated"),
  row: PaneRowSchema,
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
});
export type PaneUpdatedMessage = v.InferOutput<typeof PaneUpdatedMessageSchema>;

export const PaneRemovedMessageSchema = v.object({
  type: v.literal("pane-removed"),
  pane: v.string(),
});
export type PaneRemovedMessage = v.InferOutput<typeof PaneRemovedMessageSchema>;

export const FocusMessageSchema = v.object({
  type: v.literal("focus"),
  pane: v.nullable(v.string()),
  workspace: v.nullable(v.string()),
  cwd: v.nullable(v.string()),
  foregroundCwd: v.nullable(v.string()),
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  agentStatus: v.nullable(AgentStatusSchema),
  agentSession: v.nullable(AgentSessionInfoSchema),
});
export type FocusMessage = v.InferOutput<typeof FocusMessageSchema>;

export const RepoChangedMessageSchema = v.object({
  type: v.literal("repo-changed"),
  worktreeRoot: v.string(),
  reason: v.picklist(["status", "refs", "head"]),
  head: v.nullable(v.string()),
});
export type RepoChangedMessage = v.InferOutput<typeof RepoChangedMessageSchema>;

export const ReviewMessageSchema = v.object({
  type: v.literal("review"),
  /**
   * created: 下書き review が作られた / replied: エントリが追加された（user なら下書き） /
   * draft-updated: 下書き本文の編集または削除 / deleted: 下書きしか無かった review が消えた /
   * sent: 下書きが送信された
   */
  event: v.picklist([
    "created",
    "replied",
    "draft-updated",
    "deleted",
    "sent",
    "resolved",
    "reanchored",
    "outdated",
  ]),
  review: ReviewSchema,
});
export type ReviewMessage = v.InferOutput<typeof ReviewMessageSchema>;

export const ReviewNotifyMessageSchema = v.object({
  type: v.literal("review-notify"),
  reviewId: v.string(),
  result: v.picklist(["sent", "agent_blocked", "no_target", "unknown"]),
  pane: v.nullable(v.string()),
});
export type ReviewNotifyMessage = v.InferOutput<typeof ReviewNotifyMessageSchema>;

export const HerdrStatusMessageSchema = v.object({
  type: v.literal("herdr"),
  connected: v.boolean(),
  protocol: v.nullable(v.number()),
});
export type HerdrStatusMessage = v.InferOutput<typeof HerdrStatusMessageSchema>;

export const ServerEventMessageSchema = v.variant("type", [
  TreeMessageSchema,
  PaneUpdatedMessageSchema,
  PaneRemovedMessageSchema,
  FocusMessageSchema,
  RepoChangedMessageSchema,
  ReviewMessageSchema,
  ReviewNotifyMessageSchema,
  HerdrStatusMessageSchema,
]);
export type ServerEventMessage = v.InferOutput<typeof ServerEventMessageSchema>;

// ---------------------------------------------------------------------------
// /ws/events: client -> server
// ---------------------------------------------------------------------------

export const PinMessageSchema = v.object({
  type: v.literal("pin"),
  worktreeRoot: v.nullable(v.string()),
});
export const FocusPaneMessageSchema = v.object({ type: v.literal("focus-pane"), pane: v.string() });

export const ClientEventMessageSchema = v.variant("type", [
  PinMessageSchema,
  FocusPaneMessageSchema,
]);
export type ClientEventMessage = v.InferOutput<typeof ClientEventMessageSchema>;
