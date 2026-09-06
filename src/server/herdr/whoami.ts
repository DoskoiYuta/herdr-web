import type { AgentSessionInfo } from "../../contract/herdr";
import type { HerdrStateStore } from "./state";
import type { WorktreeResolver } from "./tree";

export type WhoamiInfo = {
  pane: string;
  workspace: string;
  cwd: string | null;
  foregroundCwd: string | null;
  worktreeRoot: string | null;
  repoKey: string | null;
  agent: string | null;
  agentSession: AgentSessionInfo | null;
};

/**
 * pane から worktree / repo / agent を解決する (plan §9.4 `/api/hw/whoami`,
 * F13-3 decision の呼び出し元解決から共用)。pane が無ければ null。
 */
export async function resolveWhoami(
  deps: { state: HerdrStateStore; resolver: WorktreeResolver },
  paneId: string,
): Promise<WhoamiInfo | null> {
  const pane = deps.state.get().panes.get(paneId);
  if (!pane) return null;
  const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
  const info = cwd ? await deps.resolver.resolve(cwd).catch(() => null) : null;
  return {
    pane: pane.pane_id,
    workspace: pane.workspace_id,
    cwd: pane.cwd ?? null,
    foregroundCwd: pane.foreground_cwd ?? null,
    worktreeRoot: info?.root ?? null,
    repoKey: info?.commonDir ?? null,
    agent: pane.agent ?? null,
    agentSession: pane.agent_session ?? null,
  };
}
