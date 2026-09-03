/**
 * Pure reducer for the `repository > worktree > pane` tree (plan.md §6.6) driven
 * by `/ws/events` server messages. Kept dependency-free and side-effect-free so
 * it's trivially unit-testable; `herdrStore.ts` wires it to `useSyncExternalStore`.
 */
import type {
  PaneRemovedMessage,
  PaneUpdatedMessage,
  Repo,
  TreeMessage,
  WorktreeRow,
} from "@contract/events";

export type TreeReducerMessage = TreeMessage | PaneUpdatedMessage | PaneRemovedMessage;

const OTHER_REPO_KEY = "other";
const OTHER_REPO_NAME = "その他";

/** Mirrors the server's `repoNameFromCommonDir` (src/server/herdr/tree.ts) for
 * repos we only learn about from a `pane-updated` message (no `name` field there). */
function repoNameFromKey(key: string): string {
  if (key === OTHER_REPO_KEY) return OTHER_REPO_NAME;
  const withoutGit = key.endsWith("/.git") ? key.slice(0, -"/.git".length) : key;
  const parts = withoutGit.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

function emptyCounts() {
  return { blocked: 0, done: 0 };
}

function countsFor(worktrees: WorktreeRow[]): Repo["counts"] {
  const counts = emptyCounts();
  for (const wt of worktrees) {
    for (const pane of wt.panes) {
      if (pane.agentStatus === "blocked") counts.blocked += 1;
      if (pane.agentStatus === "done") counts.done += 1;
    }
  }
  return counts;
}

function sortRepos(repos: Repo[]): Repo[] {
  return [...repos].sort((a, b) =>
    a.key === OTHER_REPO_KEY ? 1 : b.key === OTHER_REPO_KEY ? -1 : a.name.localeCompare(b.name),
  );
}

/** Removes the pane (by id) from every repo/worktree it currently appears in,
 * dropping worktrees and repos that become empty as a result. */
function removePane(repos: Repo[], paneId: string): Repo[] {
  const next: Repo[] = [];
  for (const repo of repos) {
    const worktrees: WorktreeRow[] = [];
    let changed = false;
    for (const wt of repo.worktrees) {
      if (!wt.panes.some((p) => p.paneId === paneId)) {
        worktrees.push(wt);
        continue;
      }
      changed = true;
      const panes = wt.panes.filter((p) => p.paneId !== paneId);
      if (panes.length > 0) worktrees.push({ ...wt, panes });
    }
    if (worktrees.length === 0) continue;
    next.push(changed ? { ...repo, worktrees, counts: countsFor(worktrees) } : repo);
  }
  return next;
}

function applyPaneUpdated(repos: Repo[], msg: PaneUpdatedMessage): Repo[] {
  const withoutPane = removePane(repos, msg.row.paneId);

  // The server's incremental `pane-updated` sends worktreeRoot/repoKey as
  // null when a pane's cwd doesn't resolve to a git repo, whereas the full
  // `tree` snapshot (src/server/herdr/tree.ts) groups those same panes under
  // the "other"/"その他" sentinel. Mirror that here so a pane doesn't
  // silently disappear from the sidebar just because it arrived via an
  // incremental update instead of the initial tree.
  const repoKey = msg.repoKey ?? OTHER_REPO_KEY;
  const worktreeRoot = msg.worktreeRoot ?? OTHER_REPO_KEY;

  const repoIndex = withoutPane.findIndex((r) => r.key === repoKey);
  let repos2: Repo[];
  let repo: Repo;
  if (repoIndex === -1) {
    repo = {
      key: repoKey,
      name: repoNameFromKey(repoKey),
      worktrees: [],
      counts: emptyCounts(),
    };
    repos2 = [...withoutPane, repo];
  } else {
    repos2 = [...withoutPane];
    repo = repos2[repoIndex]!;
  }

  const wtIndex = repo.worktrees.findIndex((w) => w.root === worktreeRoot);
  let worktrees: WorktreeRow[];
  if (wtIndex === -1) {
    worktrees = [
      ...repo.worktrees,
      { root: worktreeRoot, branch: null, isMain: true, panes: [msg.row] },
    ];
  } else {
    worktrees = repo.worktrees.map((w, i) =>
      i === wtIndex ? { ...w, panes: [...w.panes, msg.row] } : w,
    );
  }

  const updatedRepo: Repo = { ...repo, worktrees, counts: countsFor(worktrees) };
  const idx = repos2.findIndex((r) => r.key === updatedRepo.key);
  const repos3 = repos2.map((r, i) => (i === idx ? updatedRepo : r));
  return sortRepos(repos3);
}

function applyPaneRemoved(repos: Repo[], msg: PaneRemovedMessage): Repo[] {
  return removePane(repos, msg.pane);
}

export function reduceRepos(repos: Repo[], message: TreeReducerMessage): Repo[] {
  switch (message.type) {
    case "tree":
      return message.repos;
    case "pane-updated":
      return applyPaneUpdated(repos, message);
    case "pane-removed":
      return applyPaneRemoved(repos, message);
    default: {
      const exhaustiveCheck: never = message;
      return exhaustiveCheck;
    }
  }
}
