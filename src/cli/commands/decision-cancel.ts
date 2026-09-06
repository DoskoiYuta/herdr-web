import { parseArgs } from "../args";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw decision cancel <id>` */
export async function decisionCancelCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, {});
  if (!parsed.ok) return usageError(parsed.error);
  const { positionals } = parsed.value;

  const id = positionals[0];
  if (!id || positionals.length > 1) return usageError("usage: hw decision cancel <id>");

  const result = await deps.client.cancelDecision(id);
  if (!result.ok) return clientErrorResult(result.error);
  return { exitCode: EXIT_OK, stdout: `cancelled ${id}\n` };
}
