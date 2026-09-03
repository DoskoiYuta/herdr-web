import { flagBool, flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import { formatReviewList } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--path <p>] [--worktree <path>] [--json]` */
export async function reviewListCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, {
    boolean: ["all", "uncommitted", "unreachable", "json"],
    string: ["commit", "since", "path", "worktree"],
  });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(
      `hw review list takes no positional arguments, got: ${positionals.join(" ")}`,
    );
  }

  const worktreeFlag = flagString(flags, "worktree");
  const ctx = await resolveContext({
    worktreeFlag,
    env: deps.env,
    cwd: deps.cwd,
    client: deps.client,
  });
  if (!ctx.worktreeRoot || !ctx.repoKey) {
    return usageError("could not resolve the current worktree (not inside a git repository?)");
  }

  const result = await deps.client.listReviews({
    repo: ctx.repoKey,
    worktree: ctx.worktreeRoot,
    all: flagBool(flags, "all"),
    commit: flagString(flags, "commit") ?? undefined,
    since: flagString(flags, "since") ?? undefined,
    uncommitted: flagBool(flags, "uncommitted"),
    unreachable: flagBool(flags, "unreachable"),
    path: flagString(flags, "path") ?? undefined,
  });
  if (!result.ok) return clientErrorResult(result.error);

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatReviewList(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
