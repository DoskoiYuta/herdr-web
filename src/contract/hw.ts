import * as v from "valibot";
import { AgentSessionInfoSchema } from "./herdr";

export const WhoamiQuerySchema = v.object({ pane: v.string() });

/**
 * `GET /api/hw/whoami`. `worktreeRoot` / `repoKey` are the *effective* values after the
 * workspace's worktree selection (ui-redesign.md §10): the selected sub-repository's
 * worktree when one is selected, else the selected top-level worktree, else the cwd's.
 */
export const WhoamiResponseSchema = v.object({
  pane: v.string(),
  workspace: v.string(),
  cwd: v.nullable(v.string()),
  foregroundCwd: v.nullable(v.string()),
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
  /** True when nothing is saved for the pane's (workspace, repoKey) and the cwd's worktree is used. */
  selectionIsDefault: v.boolean(),
  agent: v.nullable(v.string()),
  agentSession: v.nullable(AgentSessionInfoSchema),
});
export type WhoamiResponse = v.InferOutput<typeof WhoamiResponseSchema>;
