/**
 * Request/response schemas for herdr-web's own `/api/herdr/workspace*` routes
 * (sidebar workspace create/rename/close), as opposed to `src/contract/herdr.ts`
 * which models herdr's own socket wire protocol.
 */
import * as v from "valibot";
import { AgentStatusSchema } from "./herdr";

export const WorkspaceCreateBodySchema = v.object({
  cwd: v.pipe(v.string(), v.minLength(1)),
  label: v.optional(v.string()),
  focus: v.optional(v.boolean()),
});
export type WorkspaceCreateBody = v.InferOutput<typeof WorkspaceCreateBodySchema>;

export const WorkspaceCreateResponseSchema = v.object({ workspaceId: v.string() });
export type WorkspaceCreateResponse = v.InferOutput<typeof WorkspaceCreateResponseSchema>;

export const WorkspaceRenameBodySchema = v.object({
  label: v.pipe(v.string(), v.minLength(1)),
});
export type WorkspaceRenameBody = v.InferOutput<typeof WorkspaceRenameBodySchema>;

export const WorkspaceCloseBodySchema = v.object({
  confirm: v.literal(true),
});
export type WorkspaceCloseBody = v.InferOutput<typeof WorkspaceCloseBodySchema>;

/** Shared `:id` param for the rename/close/selection routes. */
export const WorkspaceIdParamSchema = v.object({ id: v.string() });

/* ------------------------------------------------------------------ */
/* /api/herdr/workspace/:id/selection — worktree 選択（ui-redesign.md §10） */
/* ------------------------------------------------------------------ */

/** Saved per (workspace, top-level repoKey). Paths are realpath'd worktree roots. */
export const WorkspaceSelectionSchema = v.object({
  workspaceId: v.string(),
  repoKey: v.string(),
  worktreeRoot: v.string(),
  /** `SubRepo.id` under `worktreeRoot`; null when the top-level repository itself is selected. */
  subRepoId: v.nullable(v.string()),
  /** The sub-repository's worktree; null means the checkout at `worktreeRoot/subRepoId`. */
  subWorktreeRoot: v.nullable(v.string()),
  updatedAt: v.string(),
});
export type WorkspaceSelection = v.InferOutput<typeof WorkspaceSelectionSchema>;

export const WorkspaceSelectionQuerySchema = v.object({
  repoKey: v.pipe(v.string(), v.minLength(1)),
});
export type WorkspaceSelectionQuery = v.InferOutput<typeof WorkspaceSelectionQuerySchema>;

export const WorkspaceSelectionGetResponseSchema = v.object({
  selection: v.nullable(WorkspaceSelectionSchema),
});
export type WorkspaceSelectionGetResponse = v.InferOutput<
  typeof WorkspaceSelectionGetResponseSchema
>;

export const WorkspaceSelectionPutBodySchema = v.object({
  repoKey: v.pipe(v.string(), v.minLength(1)),
  worktreeRoot: v.pipe(v.string(), v.minLength(1)),
  subRepoId: v.optional(v.nullable(v.string())),
  subWorktreeRoot: v.optional(v.nullable(v.string())),
});
export type WorkspaceSelectionPutBody = v.InferOutput<typeof WorkspaceSelectionPutBodySchema>;

export const WorkspaceSelectionPutResponseSchema = v.object({
  selection: WorkspaceSelectionSchema,
});
export type WorkspaceSelectionPutResponse = v.InferOutput<
  typeof WorkspaceSelectionPutResponseSchema
>;

/**
 * Error body for the selection PUT/DELETE routes: a 400 when validation fails
 * (§10.4), or a 500 `persist_failed` when the SQLite write itself fails — the
 * in-memory selection is reverted to its previous value in that case, so a
 * client seeing this must not assume its PUT/DELETE took effect.
 */
export const WorkspaceSelectionErrorSchema = v.object({
  error: v.picklist([
    "unknown_workspace",
    "worktree_not_in_repo",
    "unknown_sub_repo",
    "sub_worktree_not_in_sub_repo",
    "persist_failed",
  ]),
});
export type WorkspaceSelectionError = v.InferOutput<typeof WorkspaceSelectionErrorSchema>;

/* ------------------------------------------------------------------ */
/* GET /api/herdr/pane-preview — 送信先 pane 選択のための可視化情報       */
/* ------------------------------------------------------------------ */

export const PanePreviewQuerySchema = v.object({ pane: v.pipe(v.string(), v.minLength(1)) });
export type PanePreviewQuery = v.InferOutput<typeof PanePreviewQuerySchema>;

/** herdr `pane.layout` の矩形（セル単位） */
export const PaneLayoutRectSchema = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});
export type PaneLayoutRect = v.InferOutput<typeof PaneLayoutRectSchema>;

export const PanePreviewLayoutPaneSchema = v.object({
  paneId: v.string(),
  focused: v.boolean(),
  rect: PaneLayoutRectSchema,
  /** その pane の表示名（label → terminal_title_stripped の順で最初にあるもの） */
  title: v.nullable(v.string()),
  agent: v.nullable(v.string()),
});
export type PanePreviewLayoutPane = v.InferOutput<typeof PanePreviewLayoutPaneSchema>;

export const PanePreviewResponseSchema = v.object({
  pane: v.string(),
  workspaceLabel: v.nullable(v.string()),
  tabLabel: v.nullable(v.string()),
  /** terminal_title_stripped（label があればそちら） */
  title: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  agentStatus: AgentStatusSchema,
  /** agent_session.value（Claude のセッション id など） */
  agentSession: v.nullable(v.string()),
  /** pane の属する tab のレイアウト。herdr から取れなければ null */
  layout: v.nullable(
    v.object({ area: PaneLayoutRectSchema, panes: v.array(PanePreviewLayoutPaneSchema) }),
  ),
  /** 直近の出力（ANSI 除去済み）の末尾数行。取れなければ空 */
  tail: v.array(v.string()),
});
export type PanePreviewResponse = v.InferOutput<typeof PanePreviewResponseSchema>;
