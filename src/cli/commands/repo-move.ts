import { parseArgs } from "../args";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw repo move <old-path> <new-path>` (plan F7-3) */
export async function repoMoveCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, {});
  if (!parsed.ok) return usageError(parsed.error);
  const { positionals } = parsed.value;
  const [from, to, ...extra] = positionals;
  if (!from || !to || extra.length > 0) {
    return usageError("usage: hw repo move <old-path> <new-path>");
  }

  const result = await deps.client.moveRepo(from, to);
  if (!result.ok) return clientErrorResult(result.error);
  return {
    exitCode: EXIT_OK,
    stdout: `moved ${result.value.repos} repo(s), rewrote ${result.value.reviews} review(s)\n`,
  };
}
