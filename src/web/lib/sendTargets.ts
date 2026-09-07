import type { PaneRow, Repo } from "@contract/events";

/**
 * Agent panes (`agent !== null`) under the worktree at `worktreeRoot`,
 * focused pane first (order otherwise unchanged) — the candidate list for
 * the ToolPane 送信 button's send target. Excludes 「質問」(ask) session panes
 * (`pane.ask`) — a review should never be sent to a question session; those
 * get answered through the ask thread's own reply flow instead.
 */
export function agentPanesAt(repos: Repo[], worktreeRoot: string): PaneRow[] {
  const worktree = repos.flatMap((repo) => repo.worktrees).find((w) => w.root === worktreeRoot);
  if (!worktree) return [];
  const panes = worktree.panes.filter((p) => p.agent !== null && p.ask !== true);
  const focused = panes.filter((p) => p.focused);
  const rest = panes.filter((p) => !p.focused);
  return [...focused, ...rest];
}

/**
 * A pane id to move herdr's focus to when opening a file location in a
 * worktree that isn't currently focused — the worktree's own focused pane,
 * or its first pane if none is focused. `null` when herdr has no pane at all
 * for that worktree.
 */
export function firstPaneAt(repos: Repo[], worktreeRoot: string): string | null {
  const worktree = repos.flatMap((repo) => repo.worktrees).find((w) => w.root === worktreeRoot);
  if (!worktree) return null;
  const focused = worktree.panes.find((p) => p.focused);
  return (focused ?? worktree.panes[0])?.paneId ?? null;
}
