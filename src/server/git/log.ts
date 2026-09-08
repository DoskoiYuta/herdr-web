import type { Commit } from "../../contract/git";
import { runGit } from "./run";

// Actual control characters, for splitting the child's stdout.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x00";
// git's own placeholder syntax for those bytes, for the --format string
// itself: passing literal NUL bytes as a spawn() argument throws.
const FIELD_SEP_PLACEHOLDER = "%x00";
const RECORD_SEP_PLACEHOLDER = "%x1e";
const LOG_FORMAT =
  ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ct", "%s", "%b"].join(FIELD_SEP_PLACEHOLDER) +
  RECORD_SEP_PLACEHOLDER;

export interface ListCommitsOptions {
  /** Cap on the number of commits returned. Default 500. */
  max?: number;
  /** `--all` (branches/tags/remotes) instead of just `HEAD`. */
  all?: boolean;
  /** Extra `git log` flags/paths passed through as-is (e.g. `-- <path>`). */
  userArgs?: string[];
  /** Extra starting revisions (e.g. stash base commits) to make reachable. */
  extraRevs?: string[];
  /**
   * Commit ordering. Default `"date"`. `"topo"` groups a branch's commits
   * together, which under `--max-count` cuts off many branches' parents
   * before their lane closes, inflating the number of simultaneously open
   * lanes in the graph.
   */
  order?: "date" | "author-date" | "topo";
}

const ORDER_FLAG: Record<NonNullable<ListCommitsOptions["order"]>, string> = {
  date: "--date-order",
  "author-date": "--author-date-order",
  topo: "--topo-order",
};

export interface ListCommitsResult {
  commits: Commit[];
  /** true when the result was cut off at `max` (more commits exist). */
  truncated: boolean;
}

/**
 * Runs `git log` with a NUL/RS-delimited format so subjects/bodies with
 * arbitrary content (newlines, non-ASCII, even NUL-adjacent punctuation)
 * parse unambiguously.
 */
export async function listCommits(
  repoDir: string,
  options: ListCommitsOptions = {},
): Promise<ListCommitsResult> {
  const { max = 500, all = false, userArgs = [], extraRevs = [], order = "date" } = options;

  const args = [
    "-c",
    "log.showSignature=false",
    "log",
    ORDER_FLAG[order],
    `--max-count=${max + 1}`,
    `--format=${LOG_FORMAT}`,
    ...(all ? ["--all"] : ["HEAD"]),
    ...extraRevs,
    ...userArgs,
  ];

  const { stdout } = await runGit(args, { cwd: repoDir });

  const records = stdout.split(RECORD_SEP).filter((r) => r.replace(/^\n+/, "").length > 0);
  const truncated = records.length > max;
  const limited = truncated ? records.slice(0, max) : records;

  const commits: Commit[] = limited.map((record) => {
    // git inserts a newline between records (format: rather than tformat:);
    // strip the leading one from every record after the first.
    const clean = record.replace(/^\n/, "");
    const fields = clean.split(FIELD_SEP);
    const [
      hash,
      parents,
      author,
      authorEmail,
      authorDate,
      committer,
      commitDate,
      subject,
      ...rest
    ] = fields;
    const body = rest.join(FIELD_SEP).replace(/\n$/, "");
    return {
      hash: hash ?? "",
      parents: parents && parents.length > 0 ? parents.split(" ") : [],
      author: author ?? "",
      authorEmail: authorEmail ?? "",
      authorDate: Number(authorDate),
      committer: committer ?? "",
      commitDate: Number(commitDate),
      subject: subject ?? "",
      body,
    };
  });

  return { commits, truncated };
}
