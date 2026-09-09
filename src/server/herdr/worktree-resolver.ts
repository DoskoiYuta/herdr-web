/**
 * Injected by the caller (a real implementation lives in `src/server/git`, owned
 * by another agent — this module never imports it). Matches `git rev-parse
 * --show-toplevel` / `--git-common-dir` / `--abbrev-ref HEAD` / `worktree list
 * --porcelain` (plan.md §6.6).
 *
 * Kept in its own leaf module (not `tree.ts`) so `pane-worktree.ts` can depend
 * on it without a `tree.ts` <-> `pane-worktree.ts` import cycle (`tree.ts`
 * depends on `pane-worktree.ts`'s `ResolvedPaneWorktree` for `buildTree`).
 */
export interface WorktreeInfo {
  /** `git rev-parse --show-toplevel` — the worktree's working directory root. */
  root: string;
  /** `git rev-parse --git-common-dir` (absolute) — the repository group key. */
  commonDir: string;
  /** `git rev-parse --abbrev-ref HEAD` (short hash if detached), or null if unresolvable. */
  branch: string | null;
  /** Is this the repo's main worktree (vs. a linked one)? */
  isMain: boolean;
}

export interface WorktreeResolver {
  resolve(path: string): Promise<WorktreeInfo | null>;
}
