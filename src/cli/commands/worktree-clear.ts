import { flagString, parseArgs } from "../args";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  EXIT_USAGE,
  usageError,
} from "./types";

/** `hw worktree clear [--pane <id>]` (pane defaults to $HERDR_PANE_ID). */
export async function worktreeClearCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { string: ["pane"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(
      `hw worktree clear takes no positional arguments, got: ${positionals.join(" ")}`,
    );
  }

  const paneId = flagString(flags, "pane") ?? deps.env.HERDR_PANE_ID ?? null;
  if (!paneId) {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: "usage: hw worktree clear --pane <id>  (or set $HERDR_PANE_ID)\n",
    };
  }

  const result = await deps.client.clearWorktreeOverride(paneId);
  if (!result.ok) return clientErrorResult(result.error);
  return { exitCode: EXIT_OK, stdout: `worktree: ${result.value.root ?? "(unknown)"}\n` };
}
