/**
 * Reconstructs `workspace > tab > pane` from the `repository > worktree > pane`
 * tree the server sends (plan.md §6.6 "表示モード: workspace"). No server
 * request involved — every `PaneRow` already carries `workspaceId`/`tabId`,
 * so this is a pure client-side regroup of the same rows.
 */
import type { PaneRow, Repo } from "@contract/events";

export type ClientTabNode = { tabId: string; panes: PaneRow[] };
export type ClientWorkspaceNode = { workspaceId: string; tabs: ClientTabNode[] };

export function buildWorkspaceView(repos: Repo[]): ClientWorkspaceNode[] {
  const tabsByWorkspace = new Map<string, Map<string, PaneRow[]>>();

  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      for (const pane of worktree.panes) {
        let tabs = tabsByWorkspace.get(pane.workspaceId);
        if (!tabs) {
          tabs = new Map();
          tabsByWorkspace.set(pane.workspaceId, tabs);
        }
        const list = tabs.get(pane.tabId) ?? [];
        list.push(pane);
        tabs.set(pane.tabId, list);
      }
    }
  }

  return [...tabsByWorkspace.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([workspaceId, tabs]) => ({
      workspaceId,
      tabs: [...tabs.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tabId, panes]) => ({ tabId, panes })),
    }));
}
