import { realpath } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";

export type LocalGitInfo = {
  root: string;
  /** `git rev-parse --git-common-dir`, made absolute + realpath'd. Doubles as the repo key. */
  repoKey: string;
};

async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) return null;
    const out = stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the git worktree root and repo key (git-common-dir) for `path`,
 * per plan §6.5/§6.6. Returns null when `path` is not inside a git repo (or
 * git is unavailable) — callers fall back to reporting "(unknown)".
 */
export async function resolveLocalGit(path: string): Promise<LocalGitInfo | null> {
  const root = await runGit(["rev-parse", "--show-toplevel"], path);
  if (!root) return null;

  const commonDirRaw = await runGit(["rev-parse", "--git-common-dir"], path);
  if (!commonDirRaw) return null;

  const absoluteCommonDir = isAbsolute(commonDirRaw)
    ? commonDirRaw
    : resolvePath(root, commonDirRaw);
  const repoKey = await realpath(absoluteCommonDir).catch(() => absoluteCommonDir);

  return { root, repoKey };
}
