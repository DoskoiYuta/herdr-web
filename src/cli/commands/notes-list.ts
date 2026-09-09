import { flagBool, flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import { formatNoteList } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw notes list [--worktree <path>] [--json]` */
export async function notesListCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json"], string: ["worktree"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(`hw notes list takes no positional arguments, got: ${positionals.join(" ")}`);
  }

  const worktreeFlag = flagString(flags, "worktree");
  const ctx = await resolveContext({
    worktreeFlag,
    env: deps.env,
    cwd: deps.cwd,
    client: deps.client,
  });
  if (!ctx.repoKey) {
    return usageError("could not resolve the current worktree (not inside a git repository?)");
  }

  const result = await deps.client.listNotes(ctx.repoKey);
  if (!result.ok) return clientErrorResult(result.error);

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatNoteList(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
