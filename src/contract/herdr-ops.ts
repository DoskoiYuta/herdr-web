/**
 * Request/response schemas for herdr-web's own `/api/herdr/workspace*` routes
 * (sidebar workspace create/rename/close), as opposed to `src/contract/herdr.ts`
 * which models herdr's own socket wire protocol.
 */
import * as v from "valibot";

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
