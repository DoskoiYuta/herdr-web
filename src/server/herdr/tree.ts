import type { PaneRow, Repo, TabNode, WorkspaceNode, WorktreeRow } from "../../contract/events";
import type { PaneInfo } from "../../contract/herdr";
import type { ResolvedPaneWorktree } from "./pane-worktree";
import type { HerdrState } from "./state";
export type { WorktreeInfo, WorktreeResolver } from "./worktree-resolver";

const OTHER_REPO_KEY = "other";
const OTHER_REPO_NAME = "その他";

/**
 * workspace が state に存在する pane だけを返す。herdr は workspace を閉じた後も
 * しばらく pane レコードを返すことがあり、そのまま出すと閉じた workspace が ID 名で残る。
 */
export function livePanes(state: HerdrState): PaneInfo[] {
  return [...state.panes.values()].filter((p) => state.workspaces.has(p.workspace_id));
}

const ASK_WORKSPACE_LABEL_PREFIX = "ask:";

/**
 * `resolved`, when given, is this pane's `ResolvedPaneWorktree` (from
 * `resolvePaneWorktree`) — it fills `effectiveRoot`/`effectiveRepoKey` with
 * the sub-repository's root/repoKey when one is selected, else the selected
 * TOP worktree's, so the browser's send-target matching (ui-redesign.md
 * §10.6) can use the exact same "effective root, else effective repoKey"
 * rule as `herdr-notifier.ts` does server-side. Omitted (both fields left
 * `undefined`) for panes with no resolvable git root (the "その他" group).
 */
export function toPaneRow(
  pane: PaneInfo,
  state?: Pick<HerdrState, "workspaces" | "tabs">,
  resolved?: ResolvedPaneWorktree | null,
): PaneRow {
  const workspaceLabel = state?.workspaces.get(pane.workspace_id)?.label ?? null;
  return {
    paneId: pane.pane_id,
    workspaceId: pane.workspace_id,
    workspaceLabel,
    tabId: pane.tab_id,
    tabLabel: state?.tabs.get(pane.tab_id)?.label ?? null,
    label: pane.label ?? null,
    agent: pane.agent ?? null,
    agentStatus: pane.agent_status,
    terminalTitleStripped: pane.terminal_title_stripped ?? null,
    focused: pane.focused,
    cwd: pane.cwd ?? null,
    foregroundCwd: pane.foreground_cwd ?? null,
    ask: workspaceLabel?.startsWith(ASK_WORKSPACE_LABEL_PREFIX) ?? false,
    effectiveRoot: resolved ? (resolved.subRepo?.root ?? resolved.worktreeRoot) : undefined,
    effectiveRepoKey: resolved ? (resolved.subRepo?.repoKey ?? resolved.repoKey) : undefined,
  };
}

/**
 * Groups panes into `repository > worktree > pane` using each pane's
 * *selected* top-level worktree (ui-redesign.md §10.3) — `resolved` is a
 * pane_id -> `ResolvedPaneWorktree|null` map the caller builds via
 * `resolvePaneWorktree`. A pane's worktree row is always the selected TOP
 * worktree, independent of any sub-repository selection. Panes with no
 * resolvable git root land in the "その他" group.
 */
export function buildTree(
  state: HerdrState,
  resolved: Map<string, ResolvedPaneWorktree | null>,
): Repo[] {
  const repos = new Map<
    string,
    { name: string; worktrees: Map<string, WorktreeRow>; blocked: number; done: number }
  >();

  function repoFor(key: string, name: string) {
    let repo = repos.get(key);
    if (!repo) {
      repo = { name, worktrees: new Map(), blocked: 0, done: 0 };
      repos.set(key, repo);
    }
    return repo;
  }

  for (const pane of livePanes(state)) {
    const info = resolved.get(pane.pane_id) ?? null;

    const repoKey = info?.repoKey ?? OTHER_REPO_KEY;
    const repoName = info ? repoNameFromCommonDir(info.repoKey) : OTHER_REPO_NAME;
    const worktreeRoot = info?.worktreeRoot ?? OTHER_REPO_KEY;

    const repo = repoFor(repoKey, repoName);
    let worktree = repo.worktrees.get(worktreeRoot);
    if (!worktree) {
      worktree = {
        root: worktreeRoot,
        branch: info?.branch ?? null,
        isMain: info?.isMain ?? true,
        panes: [],
      };
      repo.worktrees.set(worktreeRoot, worktree);
    }
    worktree.panes.push(toPaneRow(pane, state, info));

    if (pane.agent_status === "blocked") repo.blocked += 1;
    if (pane.agent_status === "done") repo.done += 1;
  }

  return [...repos.entries()]
    .map(([key, repo]) => ({
      key,
      name: repo.name,
      worktrees: [...repo.worktrees.values()],
      counts: { blocked: repo.blocked, done: repo.done },
    }))
    .sort((a, b) =>
      a.key === OTHER_REPO_KEY ? 1 : b.key === OTHER_REPO_KEY ? -1 : a.name.localeCompare(b.name),
    );
}

function repoNameFromCommonDir(commonDir: string): string {
  // commonDir is typically `<repo>/.git`; the repo's directory name reads well as a display name.
  const withoutGit = commonDir.endsWith("/.git") ? commonDir.slice(0, -"/.git".length) : commonDir;
  const parts = withoutGit.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? commonDir;
}

/** `workspace > tab > pane` view (plan.md §6.6 display mode "workspace"). */
export function buildWorkspaceTree(state: HerdrState): WorkspaceNode[] {
  const tabsByWorkspace = new Map<string, TabNode[]>();
  const panesByTab = new Map<string, PaneRow[]>();

  for (const pane of livePanes(state)) {
    const row = toPaneRow(pane, state);
    const list = panesByTab.get(pane.tab_id) ?? [];
    list.push(row);
    panesByTab.set(pane.tab_id, list);
  }

  for (const tab of state.tabs.values()) {
    const node: TabNode = {
      tabId: tab.tab_id,
      label: tab.label,
      panes: panesByTab.get(tab.tab_id) ?? [],
    };
    const list = tabsByWorkspace.get(tab.workspace_id) ?? [];
    list.push(node);
    tabsByWorkspace.set(tab.workspace_id, list);
  }

  return [...state.workspaces.values()].map((ws) => ({
    workspaceId: ws.workspace_id,
    label: ws.label,
    tabs: tabsByWorkspace.get(ws.workspace_id) ?? [],
  }));
}
