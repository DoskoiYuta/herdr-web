import type { PatchFile, PatchResponse } from "../../contract/git";
import { concatUntracked } from "./concatUntracked";
import { sha1_12 } from "./hash";
import { diffPatch, getEmptyTree, hasHead, listUntracked, noIndexPatch, runGit } from "./run";
import { splitPatchByFile } from "./splitPatch";

const UNTRACKED_LIMIT = 200;
const UNTRACKED_CONCURRENCY = 8;

export type GeneratedPatch = PatchResponse;

/**
 * Comparison selector for `generatePatch`, replacing tdiff's raw
 * `git diff` args with a small closed vocabulary the route layer can
 * validate before shelling out. `from` defaults to `HEAD`, `to` defaults
 * to `WORKTREE`.
 *
 * | to        | from      | git args                | untracked |
 * | --------- | --------- | ------------------------ | --------- |
 * | WORKTREE  | HEAD      | `diff HEAD`               | yes       |
 * | INDEX     | HEAD      | `diff --cached HEAD`      | no        |
 * | commit b  | commit a  | `diff a b`                 | no        |
 * | WORKTREE  | commit a  | `diff a`                   | yes       |
 *
 * `from: "WORKTREE"` is always rejected (there is nothing to diff the
 * worktree against itself with).
 */
export interface ComparisonSelector {
  from?: string;
  to?: string;
}

export class InvalidComparisonError extends Error {}

/** True for a commit-ish that's safe to hand to `git rev-parse`/`git diff` (never an option flag). */
function isSafeToken(x: string): boolean {
  return x.length > 0 && !x.startsWith("-");
}

/**
 * Validates `x` as an existing commit via
 * `git rev-parse --verify --end-of-options "<x>^{commit}"`.
 */
async function assertCommitish(cwd: string, x: string): Promise<void> {
  if (!isSafeToken(x)) {
    throw new InvalidComparisonError(`invalid revision: ${x}`);
  }
  try {
    await runGit(["rev-parse", "--verify", "--end-of-options", `${x}^{commit}`], {
      cwd,
      okCodes: [0],
    });
  } catch {
    throw new InvalidComparisonError(`not a commit: ${x}`);
  }
}

interface ResolvedComparison {
  gitArgs: string[];
  untracked: boolean;
}

async function resolveComparison(
  cwd: string,
  root: string,
  selector: ComparisonSelector,
  emptyTree: string | undefined,
): Promise<ResolvedComparison> {
  const from = selector.from ?? "HEAD";
  const to = selector.to ?? "WORKTREE";

  if (from === "WORKTREE") {
    throw new InvalidComparisonError("from: WORKTREE is not a valid comparison base");
  }

  const resolveHeadIsh = async (): Promise<string> => {
    return (await hasHead(root)) ? "HEAD" : (emptyTree ?? (await getEmptyTree(root)));
  };

  if (to === "WORKTREE") {
    if (from === "HEAD") {
      return { gitArgs: [await resolveHeadIsh()], untracked: true };
    }
    await assertCommitish(cwd, from);
    return { gitArgs: [from], untracked: true };
  }

  if (to === "INDEX") {
    let base = from;
    if (from === "HEAD") {
      base = await resolveHeadIsh();
    } else {
      await assertCommitish(cwd, from);
    }
    return { gitArgs: ["--cached", base], untracked: false };
  }

  // to is a commit-ish
  await assertCommitish(cwd, to);
  let base = from;
  if (from === "HEAD") {
    base = await resolveHeadIsh();
  } else {
    await assertCommitish(cwd, from);
  }
  return { gitArgs: [base, to], untracked: false };
}

/**
 * Run `worker(item, index)` over `items` with at most `concurrency` in
 * flight at once. No deps; a minimal promise pool.
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function runner(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await worker(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runner);
  await Promise.all(workers);
}

export interface GeneratePatchParams {
  cwd: string;
  root: string;
  selector: ComparisonSelector;
  emptyTree?: string;
}

/** Generate the full patch (tracked diff + optional untracked pieces) for one comparison. */
export async function generatePatch({
  cwd,
  root,
  selector,
  emptyTree,
}: GeneratePatchParams): Promise<GeneratedPatch> {
  const { gitArgs, untracked } = await resolveComparison(cwd, root, selector, emptyTree);

  const base = await diffPatch(cwd, gitArgs);
  const baseFileCount = splitPatchByFile(base).length;

  let patch = base;
  let untrackedCount = 0;
  let untrackedTruncated = false;
  let untrackedErrors = 0;

  if (untracked) {
    const untrackedPaths = await listUntracked(cwd, []);
    untrackedCount = untrackedPaths.length;
    untrackedTruncated = untrackedPaths.length > UNTRACKED_LIMIT;

    const pathsToProcess = untrackedPaths.slice(0, UNTRACKED_LIMIT);
    const pieces: (string | null)[] = new Array(pathsToProcess.length);

    await runPool(pathsToProcess, UNTRACKED_CONCURRENCY, async (path, i) => {
      try {
        pieces[i] = await noIndexPatch(root, path);
      } catch {
        untrackedErrors++;
        pieces[i] = null;
      }
    });

    const validPieces = pieces.filter((p): p is string => p !== null && p !== "");

    const concatResult = concatUntracked(base, validPieces, UNTRACKED_LIMIT);
    patch = concatResult.patch;
  }

  const allFiles = splitPatchByFile(patch);
  const files: PatchFile[] = allFiles.map((f, i) => ({
    name: f.name,
    prevName: f.prevName,
    hash: f.hash,
    oldHash: f.oldHash,
    newHash: f.newHash,
    untracked: i >= baseFileCount,
  }));

  return {
    patch,
    hash: sha1_12(patch),
    generatedAt: new Date().toISOString(),
    files,
    untrackedCount,
    untrackedTruncated,
    untrackedErrors,
  };
}
