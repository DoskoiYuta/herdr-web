import type { Commit, GraphResponse } from "../../contract/git";
import { listCommits } from "./log";
import { listRefs } from "./refs";
import { hasUncommitted } from "./status";

const UNCOMMITTED_HASH = "UNCOMMITTED";

export interface BuildGraphOptions {
  cwd: string;
  /** The `?repo=` value this graph was built for; echoed back verbatim. */
  repo: string;
  max?: number;
  all?: boolean;
  userArgs?: string[];
}

/**
 * Composes log/refs/status into one `GraphResponse`: prepends an
 * `UNCOMMITTED` pseudo-commit when the worktree is dirty, makes stash base
 * commits reachable, and scopes the walk to `HEAD` unless `all`.
 */
export async function buildGraph(options: BuildGraphOptions): Promise<GraphResponse> {
  const { cwd, repo, max = 500, all = false, userArgs = [] } = options;

  const refsResult = await listRefs(cwd);
  const extraRevs = refsResult.stashes.map((s) => s.hash);

  // `HEAD` doesn't resolve on an unborn branch (no commits yet); `git log
  // HEAD` would error rather than return nothing. Skip the walk entirely
  // when there's nothing reachable from HEAD/refs/stashes to log.
  const nothingToLog = !all && !refsResult.head.hash && extraRevs.length === 0;

  const [{ commits, truncated }, uncommitted] = await Promise.all([
    nothingToLog
      ? Promise.resolve({ commits: [] as Commit[], truncated: false })
      : listCommits(cwd, { max, all, userArgs, extraRevs }),
    hasUncommitted(cwd),
  ]);

  let allCommits: Commit[] = commits;
  if (uncommitted && refsResult.head.hash) {
    const pseudo: Commit = {
      hash: UNCOMMITTED_HASH,
      parents: [refsResult.head.hash],
      author: "",
      authorEmail: "",
      authorDate: Math.floor(Date.now() / 1000),
      committer: "",
      commitDate: Math.floor(Date.now() / 1000),
      subject: "",
      body: "",
    };
    allCommits = [pseudo, ...commits];
  }

  return {
    repo,
    commits: allCommits,
    refs: refsResult.refs,
    head: refsResult.head,
    stashes: refsResult.stashes,
    hasUncommitted: uncommitted,
    truncated,
    generatedAt: new Date().toISOString(),
  };
}
