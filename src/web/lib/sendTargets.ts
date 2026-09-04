import type { PaneRow, Repo } from "@contract/events";

/**
 * Agent panes (`agent !== null`) under the worktree at `worktreeRoot`,
 * focused pane first (order otherwise unchanged) — the candidate list for
 * the ToolPane 送信 button's send target.
 */
export function agentPanesAt(repos: Repo[], worktreeRoot: string): PaneRow[] {
  const worktree = repos.flatMap((repo) => repo.worktrees).find((w) => w.root === worktreeRoot);
  if (!worktree) return [];
  const panes = worktree.panes.filter((p) => p.agent !== null);
  const focused = panes.filter((p) => p.focused);
  const rest = panes.filter((p) => !p.focused);
  return [...focused, ...rest];
}
