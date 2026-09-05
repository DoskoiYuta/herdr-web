/**
 * Regroups one repo's `worktree > pane` rows into `workspace > pane`
 * (plan.md F8: sidebar repository mode reads as `repository > workspace >
 * pane`, not `repository > worktree(branch) > pane`). Every `PaneRow`
 * already carries `workspaceId`, so this is a pure client-side regroup of
 * the same rows the server sends — no server request involved, and no
 * reordering: worktrees are walked in server order, and within each
 * worktree panes are walked in server order, so a workspace's pane list is
 * the concatenation (in that order) of its panes across every worktree it
 * appears in.
 */
import type { PaneRow, Repo } from "@contract/events";

export type WorkspacePaneRow = PaneRow & {
  branch: string | null;
  isMain: boolean;
  worktreeRoot: string;
};

export type WorkspaceGroup = {
  workspaceId: string;
  workspaceLabel: string;
  panes: WorkspacePaneRow[];
};

function buildWorkspaceGroups(repo: Repo, include: (pane: PaneRow) => boolean): WorkspaceGroup[] {
  const order: string[] = [];
  const panesByWorkspace = new Map<string, WorkspacePaneRow[]>();

  for (const worktree of repo.worktrees) {
    for (const pane of worktree.panes) {
      if (!include(pane)) continue;
      let panes = panesByWorkspace.get(pane.workspaceId);
      if (!panes) {
        panes = [];
        panesByWorkspace.set(pane.workspaceId, panes);
        order.push(pane.workspaceId);
      }
      panes.push({
        ...pane,
        branch: worktree.branch,
        isMain: worktree.isMain,
        worktreeRoot: worktree.root,
      });
    }
  }

  return order.map((workspaceId) => ({
    workspaceId,
    workspaceLabel:
      panesByWorkspace.get(workspaceId)!.find((p) => p.workspaceLabel)?.workspaceLabel ??
      workspaceId,
    panes: panesByWorkspace.get(workspaceId)!,
  }));
}

/** Ordinary (non-ask) workspaces: `repository > workspace > pane` (plan.md F8). */
export function groupByWorkspace(repo: Repo): WorkspaceGroup[] {
  return buildWorkspaceGroups(repo, (pane) => pane.ask !== true);
}

/**
 * 「質問」(ask) workspaces only — shown in their own collapsible group under
 * the repo, not mixed into `groupByWorkspace`'s listing (a question session
 * isn't a workspace a user manages the same way; F10).
 */
export function askWorkspacesFor(repo: Repo): WorkspaceGroup[] {
  return buildWorkspaceGroups(repo, (pane) => pane.ask === true);
}
