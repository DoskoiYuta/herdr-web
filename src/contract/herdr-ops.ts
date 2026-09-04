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

/** Shared `:id` param for the rename/close routes. */
export const WorkspaceIdParamSchema = v.object({ id: v.string() });

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
