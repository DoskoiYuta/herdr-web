import { flagBool, flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import { formatAskList } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw ask list [--all] [--path <p>] [--worktree <path>] [--json]` */
export async function askListCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["all", "json"], string: ["path", "worktree"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(`hw ask list takes no positional arguments, got: ${positionals.join(" ")}`);
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

  const result = await deps.client.listAsks({
    repo: ctx.repoKey,
    worktree: ctx.worktreeRoot,
    // 既定は open,replied のみ（サーバー側の既定と同じ）。--all で resolved/outdated も含める
    status: flagBool(flags, "all") ? undefined : "open,replied",
    path: flagString(flags, "path") ?? undefined,
  });
  if (!result.ok) return clientErrorResult(result.error);

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatAskList(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
