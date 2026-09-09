// `git worktree list --porcelain` for one repository, keyed off any of its
// worktree roots (ui-redesign.md §10.4). Used both directly (GET /api/git/worktrees)
// and by subrepos.ts (each SubRepo carries its own worktree list).

import { existsSync } from "node:fs";
import { realpath as realpathAsync } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { runGit } from "./run";

export interface WorktreeEntry {
  /** Absolute, realpath'd. */
  root: string;
  /** Short branch name; null when detached. */
  branch: string | null;
  /** HEAD commit; null on an unborn branch. */
  head: string | null;
  isMain: boolean;
}

interface PorcelainBlock {
  path?: string;
  head?: string;
  branch?: string;
  detached?: boolean;
  bare?: boolean;
  prunable?: boolean;
}

function parsePorcelain(stdout: string): PorcelainBlock[] {
  const blocks: PorcelainBlock[] = [];
  let current: PorcelainBlock | null = null;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length);
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("prunable")) current.prunable = true;
  }
  if (current) blocks.push(current);
  return blocks;
}

/** `refs/heads/feature` -> `feature`. */
function shortBranchName(fullRef: string): string {
  const prefix = "refs/heads/";
  return fullRef.startsWith(prefix) ? fullRef.slice(prefix.length) : fullRef;
}

/**
 * A submodule's "main worktree" has no `.git/worktrees/<name>` entry the way a
 * linked worktree does, so `git worktree list --porcelain` run inside it
 * reports the redirected git-dir (`<super>/.git/modules/<path>`) as the
 * worktree path instead of the actual working tree — verified against a real
 * submodule checkout. A path with no `.git` entry of its own can't be a real
 * working tree, so treat it as this quirk.
 */
function looksLikeWorkingTree(path: string): boolean {
  return existsSync(join(path, ".git"));
}

function toAbsolute(base: string, maybeRelative: string): string {
  return isAbsolute(maybeRelative) ? maybeRelative : join(base, maybeRelative);
}

/**
 * Derives a submodule's actual working tree from its git-dir's `core.worktree`
 * (set when the submodule was initialized) rather than `repoPath`'s own
 * toplevel — `repoPath` may itself be a *linked* worktree of the submodule, in
 * which case `rev-parse --show-toplevel` there returns the linked worktree's
 * own path, producing a duplicate "main" entry instead of the submodule's
 * checkout. Returns null (never throws) when `core.worktree` isn't set, so the
 * caller can fall back.
 */
async function mainWorktreeViaCoreWorktree(repoPath: string): Promise<string | null> {
  try {
    const { stdout: commonDirRaw } = await runGit(["rev-parse", "--git-common-dir"], {
      cwd: repoPath,
      okCodes: [0],
    });
    const commonDir = toAbsolute(repoPath, commonDirRaw.trim());
    const { stdout: coreWorktreeRaw } = await runGit(
      ["--git-dir", commonDir, "config", "--get", "core.worktree"],
      { okCodes: [0] },
    );
    const coreWorktree = coreWorktreeRaw.trim();
    if (coreWorktree.length === 0) return null;
    return toAbsolute(commonDir, coreWorktree);
  } catch {
    return null;
  }
}

async function computeWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain"], {
    cwd: repoPath,
    okCodes: [0],
  });
  const blocks = parsePorcelain(stdout).filter((b) => b.path && !b.bare && !b.prunable);

  const entries: WorktreeEntry[] = [];
  for (const [index, block] of blocks.entries()) {
    let root = await realpathAsync(block.path!).catch(() => block.path!);
    if (!looksLikeWorkingTree(root)) {
      const viaCoreWorktree = await mainWorktreeViaCoreWorktree(repoPath);
      const fallback =
        viaCoreWorktree ??
        (
          await runGit(["rev-parse", "--show-toplevel"], { cwd: repoPath, okCodes: [0] })
        ).stdout.trim();
      root = await realpathAsync(fallback).catch(() => fallback);
    }
    entries.push({
      root,
      branch: block.branch ? shortBranchName(block.branch) : null,
      head: block.head ?? null,
      // `git worktree list` always lists the main worktree first.
      isMain: index === 0,
    });
  }
  return entries;
}

interface CacheEntry {
  at: number;
  promise: Promise<WorktreeEntry[]>;
}

const TTL_MS = 5000;
const cache = new Map<string, CacheEntry>();

/** Lists every worktree of the repository containing `repoPath`. Cached per `repoPath` for `TTL_MS`. */
export function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const cached = cache.get(repoPath);
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.promise;

  const promise = computeWorktrees(repoPath);
  cache.set(repoPath, { at: now, promise });
  promise.catch(() => cache.delete(repoPath));
  return promise;
}

/** Drops every cached entry (test-only escape hatch). */
export function invalidateWorktreesCache(): void {
  cache.clear();
}
