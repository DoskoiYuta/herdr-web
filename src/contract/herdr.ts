/**
 * valibot schemas for the subset of the herdr socket API (protocol 22, herdr 0.9.0)
 * that herdr-web uses. Loose objects everywhere per plan.md N6: unknown fields are
 * ignored so herdr can add fields without breaking us.
 *
 * Verified against the running herdr instance via `herdr api schema --json` and a
 * live NDJSON probe against ~/.config/herdr/herdr.sock (see gateway/socket-client
 * report for the exact wire envelopes observed).
 */
import * as v from "valibot";

export const AgentStatusSchema = v.picklist(["idle", "working", "blocked", "done", "unknown"]);
export type AgentStatus = v.InferOutput<typeof AgentStatusSchema>;

export const AgentSessionRefKindSchema = v.picklist(["id", "path"]);
export type AgentSessionRefKind = v.InferOutput<typeof AgentSessionRefKindSchema>;

export const AgentSessionInfoSchema = v.looseObject({
  source: v.string(),
  agent: v.string(),
  kind: AgentSessionRefKindSchema,
  value: v.string(),
});
export type AgentSessionInfo = v.InferOutput<typeof AgentSessionInfoSchema>;

/** herdr's `PaneInfo` (and, loosely, the near-identical `AgentInfo` used in `session.snapshot.agents`). */
export const PaneInfoSchema = v.looseObject({
  pane_id: v.string(),
  terminal_id: v.string(),
  workspace_id: v.string(),
  tab_id: v.string(),
  focused: v.boolean(),
  agent_status: AgentStatusSchema,
  revision: v.number(),
  agent: v.nullish(v.string()),
  agent_session: v.nullish(AgentSessionInfoSchema),
  cwd: v.nullish(v.string()),
  foreground_cwd: v.nullish(v.string()),
  label: v.nullish(v.string()),
  terminal_title: v.nullish(v.string()),
  terminal_title_stripped: v.nullish(v.string()),
  title: v.nullish(v.string()),
});
export type PaneInfo = v.InferOutput<typeof PaneInfoSchema>;

export const WorkspaceWorktreeInfoSchema = v.looseObject({
  repo_key: v.string(),
  repo_name: v.string(),
  repo_root: v.string(),
  checkout_path: v.string(),
  is_linked_worktree: v.boolean(),
});
export type WorkspaceWorktreeInfo = v.InferOutput<typeof WorkspaceWorktreeInfoSchema>;

export const WorkspaceInfoSchema = v.looseObject({
  workspace_id: v.string(),
  number: v.number(),
  label: v.string(),
  focused: v.boolean(),
  pane_count: v.number(),
  tab_count: v.number(),
  active_tab_id: v.string(),
  agent_status: AgentStatusSchema,
  worktree: v.nullish(WorkspaceWorktreeInfoSchema),
});
export type WorkspaceInfo = v.InferOutput<typeof WorkspaceInfoSchema>;

export const TabInfoSchema = v.looseObject({
  tab_id: v.string(),
  workspace_id: v.string(),
  number: v.number(),
  label: v.string(),
  focused: v.boolean(),
  pane_count: v.number(),
  agent_status: AgentStatusSchema,
});
export type TabInfo = v.InferOutput<typeof TabInfoSchema>;

export const WorktreeInfoSchema = v.looseObject({
  path: v.string(),
  is_bare: v.boolean(),
  is_detached: v.boolean(),
  is_prunable: v.boolean(),
  is_linked_worktree: v.boolean(),
  label: v.string(),
  branch: v.nullish(v.string()),
  open_workspace_id: v.nullish(v.string()),
});
export type WorktreeInfo = v.InferOutput<typeof WorktreeInfoSchema>;

export const SessionSnapshotSchema = v.looseObject({
  version: v.string(),
  protocol: v.number(),
  workspaces: v.array(WorkspaceInfoSchema),
  tabs: v.array(TabInfoSchema),
  panes: v.array(PaneInfoSchema),
  agents: v.array(PaneInfoSchema),
  focused_pane_id: v.nullish(v.string()),
  focused_tab_id: v.nullish(v.string()),
  focused_workspace_id: v.nullish(v.string()),
});
export type SessionSnapshot = v.InferOutput<typeof SessionSnapshotSchema>;

export const PingResultSchema = v.looseObject({
  type: v.literal("pong"),
  version: v.string(),
  protocol: v.number(),
});
export type PingResult = v.InferOutput<typeof PingResultSchema>;

/**
 * The subscription_event/event envelope: `{ event: <EventKind>, data: <tagged union> }`.
 * `data.type` always mirrors `event`. We model the full `EventKind` enum (26 variants)
 * so `applyEvent` can `.exhaustive()` over it, even though herdr-web only *acts* on a
 * subset (pane/workspace/tab lifecycle + focus).
 */
export const PaneCreatedEventSchema = v.looseObject({
  type: v.literal("pane_created"),
  pane: PaneInfoSchema,
});
export const PaneClosedEventSchema = v.looseObject({
  type: v.literal("pane_closed"),
  pane_id: v.string(),
  workspace_id: v.string(),
});
export const PaneUpdatedEventSchema = v.looseObject({
  type: v.literal("pane_updated"),
  pane: PaneInfoSchema,
});
export const PaneFocusedEventSchema = v.looseObject({
  type: v.literal("pane_focused"),
  pane_id: v.string(),
  workspace_id: v.string(),
});
export const PaneMovedEventSchema = v.looseObject({
  type: v.literal("pane_moved"),
  pane: PaneInfoSchema,
  previous_pane_id: v.string(),
  previous_workspace_id: v.string(),
  previous_tab_id: v.string(),
});
export const PaneExitedEventSchema = v.looseObject({
  type: v.literal("pane_exited"),
  pane_id: v.string(),
  workspace_id: v.string(),
});
export const PaneAgentDetectedEventSchema = v.looseObject({
  type: v.literal("pane_agent_detected"),
  pane_id: v.string(),
  workspace_id: v.string(),
  agent: v.nullish(v.string()),
  final_status: v.nullish(AgentStatusSchema),
  released: v.optional(v.boolean()),
});
export const PaneAgentStatusChangedEventSchema = v.looseObject({
  type: v.literal("pane_agent_status_changed"),
  pane_id: v.string(),
  workspace_id: v.string(),
  agent_status: AgentStatusSchema,
  agent: v.nullish(v.string()),
  display_agent: v.nullish(v.string()),
  title: v.nullish(v.string()),
});
export const WorkspaceCreatedEventSchema = v.looseObject({
  type: v.literal("workspace_created"),
  workspace: WorkspaceInfoSchema,
});
export const WorkspaceUpdatedEventSchema = v.looseObject({
  type: v.literal("workspace_updated"),
  workspace: WorkspaceInfoSchema,
});
export const WorkspaceMetadataUpdatedEventSchema = v.looseObject({
  type: v.literal("workspace_metadata_updated"),
  workspace: WorkspaceInfoSchema,
});
export const WorkspaceClosedEventSchema = v.looseObject({
  type: v.literal("workspace_closed"),
  workspace_id: v.string(),
  workspace: v.nullish(WorkspaceInfoSchema),
});
export const WorkspaceRenamedEventSchema = v.looseObject({
  type: v.literal("workspace_renamed"),
  workspace_id: v.string(),
  label: v.string(),
});
export const WorkspaceMovedEventSchema = v.looseObject({
  type: v.literal("workspace_moved"),
  workspace_id: v.string(),
  insert_index: v.number(),
  workspaces: v.array(WorkspaceInfoSchema),
});
export const WorkspaceReorderedEventSchema = v.looseObject({
  type: v.literal("workspace_reordered"),
  workspace_ids: v.array(v.string()),
  workspaces: v.array(WorkspaceInfoSchema),
});
export const WorkspaceFocusedEventSchema = v.looseObject({
  type: v.literal("workspace_focused"),
  workspace_id: v.string(),
});
export const WorktreeCreatedEventSchema = v.looseObject({
  type: v.literal("worktree_created"),
  workspace: WorkspaceInfoSchema,
  worktree: WorktreeInfoSchema,
});
export const WorktreeOpenedEventSchema = v.looseObject({
  type: v.literal("worktree_opened"),
  workspace: WorkspaceInfoSchema,
  worktree: WorktreeInfoSchema,
  already_open: v.boolean(),
});
export const WorktreeRemovedEventSchema = v.looseObject({
  type: v.literal("worktree_removed"),
  workspace_id: v.string(),
  workspace: v.nullish(WorkspaceInfoSchema),
  worktree: WorktreeInfoSchema,
  forced: v.boolean(),
});
export const TabCreatedEventSchema = v.looseObject({
  type: v.literal("tab_created"),
  tab: TabInfoSchema,
});
export const TabClosedEventSchema = v.looseObject({
  type: v.literal("tab_closed"),
  tab_id: v.string(),
  workspace_id: v.string(),
});
export const TabRenamedEventSchema = v.looseObject({
  type: v.literal("tab_renamed"),
  tab_id: v.string(),
  workspace_id: v.string(),
  label: v.string(),
});
export const TabMovedEventSchema = v.looseObject({
  type: v.literal("tab_moved"),
  tab_id: v.string(),
  workspace_id: v.string(),
  insert_index: v.number(),
  tabs: v.array(TabInfoSchema),
});
export const TabFocusedEventSchema = v.looseObject({
  type: v.literal("tab_focused"),
  tab_id: v.string(),
  workspace_id: v.string(),
});
export const LayoutUpdatedEventSchema = v.looseObject({ type: v.literal("layout_updated") });

export const HerdrEventDataSchema = v.variant("type", [
  PaneCreatedEventSchema,
  PaneClosedEventSchema,
  PaneUpdatedEventSchema,
  PaneFocusedEventSchema,
  PaneMovedEventSchema,
  PaneExitedEventSchema,
  PaneAgentDetectedEventSchema,
  PaneAgentStatusChangedEventSchema,
  WorkspaceCreatedEventSchema,
  WorkspaceUpdatedEventSchema,
  WorkspaceMetadataUpdatedEventSchema,
  WorkspaceClosedEventSchema,
  WorkspaceRenamedEventSchema,
  WorkspaceMovedEventSchema,
  WorkspaceReorderedEventSchema,
  WorkspaceFocusedEventSchema,
  WorktreeCreatedEventSchema,
  WorktreeOpenedEventSchema,
  WorktreeRemovedEventSchema,
  TabCreatedEventSchema,
  TabClosedEventSchema,
  TabRenamedEventSchema,
  TabMovedEventSchema,
  TabFocusedEventSchema,
  LayoutUpdatedEventSchema,
]);
export type HerdrEventData = v.InferOutput<typeof HerdrEventDataSchema>;

export const HerdrEventEnvelopeSchema = v.looseObject({
  event: v.string(),
  data: HerdrEventDataSchema,
});
export type HerdrEventEnvelope = v.InferOutput<typeof HerdrEventEnvelopeSchema>;

/** The 24 subscription kinds herdr-web subscribes to (dot notation, as `events.subscribe` expects). */
export const HERDR_SUBSCRIPTIONS = [
  { type: "pane.created" },
  { type: "pane.closed" },
  { type: "pane.updated" },
  { type: "pane.focused" },
  { type: "pane.moved" },
  { type: "pane.exited" },
  { type: "pane.agent_detected" },
  { type: "workspace.created" },
  { type: "workspace.updated" },
  { type: "workspace.metadata_updated" },
  { type: "workspace.closed" },
  { type: "workspace.renamed" },
  { type: "workspace.moved" },
  { type: "workspace.reordered" },
  { type: "workspace.focused" },
  { type: "worktree.created" },
  { type: "worktree.opened" },
  { type: "worktree.removed" },
  { type: "tab.created" },
  { type: "tab.closed" },
  { type: "tab.renamed" },
  { type: "tab.moved" },
  { type: "tab.focused" },
  { type: "layout.updated" },
] as const;

/** `agent.prompt`'s successful result: `{ type: "agent_prompted", agent: PaneInfo }`. */
export const AgentPromptedResultSchema = v.looseObject({
  type: v.literal("agent_prompted"),
  agent: PaneInfoSchema,
});
export type AgentPromptedResult = v.InferOutput<typeof AgentPromptedResultSchema>;

/** `notification.show`'s successful result: `{ type: "notification_shown" }` (F13-11). */
export const NotificationShownResultSchema = v.looseObject({
  type: v.literal("notification_shown"),
});
export type NotificationShownResult = v.InferOutput<typeof NotificationShownResultSchema>;

/**
 * `workspace.create`'s successful result, verified live against herdr 0.8.2:
 * `{ type: "workspace_created", workspace, tab, root_pane }`.
 */
export const WorkspaceCreatedResultSchema = v.looseObject({
  type: v.literal("workspace_created"),
  workspace: WorkspaceInfoSchema,
  tab: TabInfoSchema,
  root_pane: PaneInfoSchema,
});
export type WorkspaceCreatedResult = v.InferOutput<typeof WorkspaceCreatedResultSchema>;

/**
 * `workspace.rename`'s successful result, verified live against herdr 0.8.2:
 * `{ type: "workspace_info", workspace }`.
 */
export const WorkspaceInfoResultSchema = v.looseObject({
  type: v.literal("workspace_info"),
  workspace: WorkspaceInfoSchema,
});
export type WorkspaceInfoResult = v.InferOutput<typeof WorkspaceInfoResultSchema>;

/** `pane.list`'s successful result: `{ type: "pane_list", panes: PaneInfo[] }` (per `herdr api schema --json`). */
export const PaneListResultSchema = v.looseObject({
  type: v.literal("pane_list"),
  panes: v.array(PaneInfoSchema),
});
export type PaneListResult = v.InferOutput<typeof PaneListResultSchema>;

/**
 * `agent.start`'s successful result: `{ type: "agent_started", agent, argv }`
 * (per `herdr api schema --json`). `agent` has the same shape as `PaneInfo`.
 */
export const AgentStartedResultSchema = v.looseObject({
  type: v.literal("agent_started"),
  agent: PaneInfoSchema,
  argv: v.array(v.string()),
});
export type AgentStartedResult = v.InferOutput<typeof AgentStartedResultSchema>;

/**
 * herdr's error codes are untyped strings (`ErrorBody.code`). The two we treat
 * specially per plan.md §3: `agent.prompt` rejects with `agent_blocked` before
 * sending anything when the agent is at an approval/question UI, and with
 * `agent_prompt_stalled` if a prompt from a non-working state produces no
 * observed lifecycle change within herdr's internal timeout.
 */
export const HERDR_AGENT_PROMPT_ERROR_CODES = ["agent_blocked", "agent_prompt_stalled"] as const;
export type HerdrAgentPromptErrorCode = (typeof HERDR_AGENT_PROMPT_ERROR_CODES)[number];

export const HerdrErrorBodySchema = v.object({ code: v.string(), message: v.string() });
export type HerdrErrorBody = v.InferOutput<typeof HerdrErrorBodySchema>;

/** Rect shared by `pane.layout`'s `area` and per-pane `rect` (cell units). */
export const HerdrRectSchema = v.looseObject({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});
export type HerdrRect = v.InferOutput<typeof HerdrRectSchema>;

/** `pane.layout`'s successful result (`PaneLayoutSnapshot` in herdr's schema). */
export const PaneLayoutSnapshotSchema = v.looseObject({
  workspace_id: v.string(),
  tab_id: v.string(),
  zoomed: v.boolean(),
  area: HerdrRectSchema,
  focused_pane_id: v.nullish(v.string()),
  panes: v.array(
    v.looseObject({ pane_id: v.string(), focused: v.boolean(), rect: HerdrRectSchema }),
  ),
  splits: v.array(v.unknown()),
});
export type PaneLayoutSnapshot = v.InferOutput<typeof PaneLayoutSnapshotSchema>;

/** `pane.read`'s successful result (`PaneReadResult` in herdr's schema). */
export const PaneReadResultSchema = v.looseObject({
  text: v.string(),
  truncated: v.boolean(),
});
export type PaneReadResult = v.InferOutput<typeof PaneReadResultSchema>;
