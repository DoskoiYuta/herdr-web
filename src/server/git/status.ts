import { runGit } from "./run";

/**
 * True when the worktree has uncommitted changes: staged, unstaged, or
 * untracked files.
 */
export async function hasUncommitted(repoDir: string): Promise<boolean> {
  const { stdout } = await runGit(["status", "--porcelain=v2", "-z", "--untracked-files=normal"], {
    cwd: repoDir,
  });
  return stdout.length > 0;
}
