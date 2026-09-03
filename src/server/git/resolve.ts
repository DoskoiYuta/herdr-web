import { realpath } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { runGit } from "./run";

export interface WorktreeInfo {
  root: string;
  /** `git --git-common-dir`, made absolute + realpath'd. Doubles as the repo key. */
  commonDir: string;
  branch: string | null;
  isMain: boolean;
  head: string | null;
  /** oldest `rev-list --max-parents=0 HEAD` entry; null on an unborn branch. */
  rootCommit: string | null;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, Promise<WorktreeInfo | null>>();

/** Drops any cached result for exactly `path` (as previously passed to `resolveWorktree`). */
export function invalidate(path: string): void {
  cache.delete(path);
}

/** Drops every cached entry. */
export function invalidateAll(): void {
  cache.clear();
}

async function computeRootCommit(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-list", "--max-parents=0", "HEAD"], { cwd, okCodes: [0] });
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    // git lists roots newest-reachable-first; the oldest root commit is last.
    return lines[lines.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function computeBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, okCodes: [0] });
    const branch = stdout.trim();
    return branch === "HEAD" || branch.length === 0 ? null : branch;
  } catch {
    return null;
  }
}

async function computeHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "HEAD"], { cwd, okCodes: [0] });
    const head = stdout.trim();
    return head.length === 0 ? null : head;
  } catch {
    return null;
  }
}

async function computeIsMain(cwd: string, root: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(["worktree", "list", "--porcelain"], { cwd, okCodes: [0] });
    const firstWorktreeLine = stdout.split("\n").find((l) => l.startsWith("worktree "));
    if (!firstWorktreeLine) return true;
    const firstPath = firstWorktreeLine.slice("worktree ".length).trim();
    const [realFirst, realRoot] = await Promise.all([
      realpath(firstPath).catch(() => firstPath),
      realpath(root).catch(() => root),
    ]);
    return realFirst === realRoot;
  } catch {
    return true;
  }
}

async function computeWorktreeInfo(path: string): Promise<WorktreeInfo | null> {
  let root: string;
  try {
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd: path, okCodes: [0] });
    root = stdout.trim();
  } catch {
    return null;
  }
  if (root.length === 0) return null;

  let commonDirRaw: string;
  try {
    const { stdout } = await runGit(["rev-parse", "--git-common-dir"], { cwd: path, okCodes: [0] });
    commonDirRaw = stdout.trim();
  } catch {
    return null;
  }
  const absoluteCommonDir = isAbsolute(commonDirRaw)
    ? commonDirRaw
    : resolvePath(root, commonDirRaw);
  const commonDir = await realpath(absoluteCommonDir).catch(() => absoluteCommonDir);

  const [branch, head, rootCommit, isMain] = await Promise.all([
    computeBranch(path),
    computeHead(path),
    computeRootCommit(path),
    computeIsMain(path, root),
  ]);

  return { root, commonDir, branch, isMain, head, rootCommit };
}

/**
 * Resolves the git worktree containing `path`. Returns `null` (never
 * throws) when `path` is not inside a git repository. Results are cached
 * per exact `path` string; call `invalidate(path)` to force a refresh.
 */
export function resolveWorktree(path: string): Promise<WorktreeInfo | null> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  const promise = computeWorktreeInfo(path).catch(() => null);
  if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(path, promise);
  return promise;
}
