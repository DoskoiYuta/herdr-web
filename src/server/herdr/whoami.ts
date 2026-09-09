import type { AgentSessionInfo } from "../../contract/herdr";
import { resolvePaneWorktree, type PaneWorktreeDeps } from "./pane-worktree";
import type { HerdrStateStore } from "./state";

export type WhoamiInfo = {
  pane: string;
  workspace: string;
  cwd: string | null;
  foregroundCwd: string | null;
  worktreeRoot: string | null;
  repoKey: string | null;
  selectionIsDefault: boolean;
  agent: string | null;
  agentSession: AgentSessionInfo | null;
};

/**
 * pane から worktree / repo / agent を解決する (plan §9.4 `/api/hw/whoami`,
 * F13-3 decision の呼び出し元解決から共用)。pane が無ければ null。
 *
 * `worktreeRoot`/`repoKey` are the *effective* values (ui-redesign.md §10.4):
 * the selected sub-repository's root/repoKey when one is selected, else the
 * selected top-level worktree's.
 */
export async function resolveWhoami(
  deps: Pick<PaneWorktreeDeps, "state" | "resolver" | "listWorktrees" | "listSubRepos"> & {
    state: HerdrStateStore;
  },
  paneId: string,
): Promise<WhoamiInfo | null> {
  const s = deps.state.get();
  const pane = s.panes.get(paneId);
  if (!pane) return null;
  const resolved = await resolvePaneWorktree(deps, pane);
  return {
    pane: pane.pane_id,
    workspace: pane.workspace_id,
    cwd: pane.cwd ?? null,
    foregroundCwd: pane.foreground_cwd ?? null,
    worktreeRoot: resolved?.subRepo?.root ?? resolved?.worktreeRoot ?? null,
    repoKey: resolved?.subRepo?.repoKey ?? resolved?.repoKey ?? null,
    selectionIsDefault: resolved?.selectionIsDefault ?? true,
    agent: pane.agent ?? null,
    agentSession: pane.agent_session ?? null,
  };
}
