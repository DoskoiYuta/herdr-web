import type { FocusSubRepo } from "../../contract/events";
import type { HerdrStateStore, Logger } from "./state";
import type { WorktreeResolver } from "./worktree-resolver";

/** Structural subset of `git/worktrees.ts`'s `WorktreeEntry`. */
export interface WorktreeEntryLike {
  root: string;
  branch: string | null;
  head: string | null;
  isMain: boolean;
}

/** Structural subset of `git/subrepos.ts`'s `SubRepo`. */
export interface SubRepoLike {
  id: string;
  name: string;
  root: string;
  kind: "root" | "submodule" | "vcs";
  worktrees: WorktreeEntryLike[];
}

export interface PaneWorktreeDeps {
  state: Pick<HerdrStateStore, "getSelection" | "setSelection">;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
  logger?: Logger;
}

export type ResolvedPaneWorktree = {
  worktreeRoot: string;
  branch: string | null;
  isMain: boolean;
  repoKey: string;
  subRepo: FocusSubRepo | null;
  /** True when nothing is saved for `(workspaceId, repoKey)` and `worktreeRoot` is just the cwd's worktree. */
  selectionIsDefault: boolean;
};

type MinimalPane = {
  workspace_id: string;
  foreground_cwd?: string | null;
  cwd?: string | null;
};

/**
 * The single choke point every reader of a pane's effective worktree must use
 * (ui-redesign.md §10.3, replacing `effectiveCwd`): resolves the pane's raw cwd
 * to a repository, looks up the saved `(workspace, repoKey)` selection, and
 * validates it against the repository's current worktree/sub-repository lists —
 * rewriting (and persisting the rewrite) back to the default whenever a saved
 * choice has since disappeared, per §10.2's "消す対".
 */
export async function resolvePaneWorktree(
  deps: PaneWorktreeDeps,
  pane: MinimalPane | null | undefined,
): Promise<ResolvedPaneWorktree | null> {
  const logger = deps.logger ?? console;
  if (!pane) return null;
  const rawCwd = pane.foreground_cwd ?? pane.cwd ?? null;
  if (!rawCwd) return null;

  const cwdInfo = await deps.resolver.resolve(rawCwd).catch(() => null);
  if (!cwdInfo) return null;
  const repoKey = cwdInfo.commonDir;

  const selection = deps.state.getSelection(pane.workspace_id, repoKey);
  if (!selection) {
    return {
      worktreeRoot: cwdInfo.root,
      branch: cwdInfo.branch,
      isMain: cwdInfo.isMain,
      repoKey,
      subRepo: null,
      selectionIsDefault: true,
    };
  }

  // A `catch` here would make a transient git failure indistinguishable from
  // "the worktree is really gone" — that would revert (and persist-overwrite)
  // the user's saved selection on every hiccup, and since the rewrite itself
  // triggers a `reset` notification, a git command that keeps failing would
  // re-resolve and re-rewrite forever. Only an actually-successful, non-empty
  // list is trusted as ground truth for "gone"; a thrown error or an empty
  // list is treated as "unknown right now" and leaves the selection untouched.
  let worktrees: WorktreeEntryLike[] | null;
  try {
    worktrees = await deps.listWorktrees(cwdInfo.root);
  } catch {
    worktrees = null;
  }
  const worktreesKnown = worktrees !== null && worktrees.length > 0;

  let subRepoId = selection.subRepoId;
  let subWorktreeRoot = selection.subWorktreeRoot;
  let worktreeEntry: WorktreeEntryLike;

  if (worktreesKnown) {
    const found = worktrees!.find((w) => w.root === selection.worktreeRoot);
    if (found) {
      worktreeEntry = found;
    } else {
      const mainEntry = worktrees!.find((w) => w.isMain);
      logger.warn(
        `herdr: saved worktree ${selection.worktreeRoot} for workspace ${pane.workspace_id} ` +
          `repo ${repoKey} no longer exists; reverting to main worktree`,
      );
      worktreeEntry = mainEntry ?? {
        root: cwdInfo.root,
        branch: cwdInfo.branch,
        head: null,
        isMain: cwdInfo.isMain,
      };
      subRepoId = null;
      subWorktreeRoot = null;
      void deps.state.setSelection({
        workspaceId: pane.workspace_id,
        repoKey,
        worktreeRoot: worktreeEntry.root,
        subRepoId: null,
        subWorktreeRoot: null,
      });
    }
  } else {
    // Can't confirm the saved worktree either way — keep the saved root, but
    // its branch/isMain can't be determined without the (currently unusable) list.
    worktreeEntry = { root: selection.worktreeRoot, branch: null, head: null, isMain: false };
  }

  let subRepo: FocusSubRepo | null = null;
  if (subRepoId !== null) {
    let subRepos: SubRepoLike[] | null;
    try {
      subRepos = await deps.listSubRepos(worktreeEntry.root);
    } catch {
      subRepos = null;
    }
    const subReposKnown = subRepos !== null && subRepos.length > 0;

    if (subReposKnown) {
      const sub = subRepos!.find((r) => r.id === subRepoId);
      if (!sub) {
        logger.warn(
          `herdr: saved sub-repository ${subRepoId} under ${worktreeEntry.root} no longer ` +
            `exists; clearing it for workspace ${pane.workspace_id}`,
        );
        void deps.state.setSelection({
          workspaceId: pane.workspace_id,
          repoKey,
          worktreeRoot: worktreeEntry.root,
          subRepoId: null,
          subWorktreeRoot: null,
        });
      } else {
        let effectiveSubRoot = sub.root;
        if (subWorktreeRoot !== null) {
          if (sub.worktrees.length > 0) {
            const subWorktreeEntry = sub.worktrees.find((w) => w.root === subWorktreeRoot);
            if (!subWorktreeEntry) {
              logger.warn(
                `herdr: saved sub-repository worktree ${subWorktreeRoot} for ${sub.id} no longer ` +
                  `exists; reverting to its default checkout`,
              );
              void deps.state.setSelection({
                workspaceId: pane.workspace_id,
                repoKey,
                worktreeRoot: worktreeEntry.root,
                subRepoId: sub.id,
                subWorktreeRoot: null,
              });
            } else {
              effectiveSubRoot = subWorktreeEntry.root;
            }
          } else {
            // Can't confirm either way — keep using the saved sub-worktree root as-is.
            effectiveSubRoot = subWorktreeRoot;
          }
        }
        const subInfo = await deps.resolver.resolve(effectiveSubRoot).catch(() => null);
        if (subInfo && (sub.kind === "submodule" || sub.kind === "vcs")) {
          subRepo = {
            id: sub.id,
            name: sub.name,
            kind: sub.kind,
            root: effectiveSubRoot,
            repoKey: subInfo.commonDir,
          };
        }
      }
    }
    // else: can't confirm the sub-repository either way — leave the saved
    // selection untouched, but there's no SubRepoLike to build a FocusSubRepo
    // from, so `subRepo` degrades to null for this resolution only.
  }

  return {
    worktreeRoot: worktreeEntry.root,
    branch: worktreeEntry.branch,
    isMain: worktreeEntry.isMain,
    repoKey,
    subRepo,
    selectionIsDefault: false,
  };
}
