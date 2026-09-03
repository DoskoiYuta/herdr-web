import * as v from "valibot";
import { AgentSessionInfoSchema } from "./herdr";

export const WhoamiQuerySchema = v.object({ pane: v.string() });

export const WhoamiResponseSchema = v.object({
  pane: v.string(),
  workspace: v.string(),
  cwd: v.nullable(v.string()),
  foregroundCwd: v.nullable(v.string()),
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  agentSession: v.nullable(AgentSessionInfoSchema),
});
export type WhoamiResponse = v.InferOutput<typeof WhoamiResponseSchema>;
