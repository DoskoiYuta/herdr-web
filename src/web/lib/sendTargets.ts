import type { PaneRow, Repo } from "@contract/events";

function agentPaneEntries(
  repos: Repo[],
): { pane: PaneRow; worktreeRoot: string; repoKey: string }[] {
  const entries: { pane: PaneRow; worktreeRoot: string; repoKey: string }[] = [];
  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      for (const pane of worktree.panes) {
        if (pane.agent === null || pane.ask === true) continue;
        entries.push({ pane, worktreeRoot: worktree.root, repoKey: repo.key });
      }
    }
  }
  return entries;
}

function focusedFirst(panes: PaneRow[]): PaneRow[] {
  const focused = panes.filter((p) => p.focused);
  const rest = panes.filter((p) => !p.focused);
  return [...focused, ...rest];
}

/**
 * Send-target candidate list (レビュー送信・質問の送信先ダイアログ, §10.6),
 * scoped to match the server notifier's own reach (`herdr-notifier.ts`) so
 * the picker never offers a pane the server would then reject.
 *
 * `effectiveRoot`/`effectiveRepoKey` are the *effective* selection (the
 * sub-repository's when one is selected, else the top worktree/repo — see
 * `FocusSubRepo`/§10.3). A pane's own `effectiveRoot`/`effectiveRepoKey`
 * (server-computed from *its* workspace's selection) is compared first —
 * this is what lets an agent pane in another workspace act as the target
 * for a sub-repository review, even though that pane's own worktree row is
 * a different top-level worktree. Panes without those fields (older/other
 * server payloads) fall back to their enclosing worktree root / repo key.
 *
 * First tries an exact root match; if none, widens to any pane whose
 * effective repo matches (so a worktree with no agent doesn't strand the
 * user with `no_target`). Focused pane first within each tier.
 */
export function sendTargetsFor(
  repos: Repo[],
  effectiveRoot: string,
  effectiveRepoKey: string,
): PaneRow[] {
  const entries = agentPaneEntries(repos);
  const atRoot = entries
    .filter((e) => (e.pane.effectiveRoot ?? e.worktreeRoot) === effectiveRoot)
    .map((e) => e.pane);
  if (atRoot.length > 0) return focusedFirst(atRoot);
  const inRepo = entries
    .filter((e) => (e.pane.effectiveRepoKey ?? e.repoKey) === effectiveRepoKey)
    .map((e) => e.pane);
  return focusedFirst(inRepo);
}

/**
 * 現在 herdr 上で動いている「質問」(ask) 専用ワークスペースの数（全 worktree
 * 横断）。送信先ダイアログの「同時 N/M」表示用 — サーバー側の
 * `liveAskWorkspaceCount`（src/server/herdr/ask-session.ts）と同じくワーク
 * スペース単位で数える（pane 単位で数えると、1 ワークスペースが複数 pane に
 * 分割されたときに水増しされる）。
 */
export function liveAskSessionCount(repos: Repo[]): number {
  const workspaceIds = new Set<string>();
  for (const pane of repos.flatMap((repo) => repo.worktrees).flatMap((w) => w.panes)) {
    if (pane.ask === true) workspaceIds.add(pane.workspaceId);
  }
  return workspaceIds.size;
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
