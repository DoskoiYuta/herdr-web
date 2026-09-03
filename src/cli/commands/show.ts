import { flagBool, parseArgs } from "../args";
import { formatReviewShow } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw review show <id> [--json]` */
export async function reviewShowCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;

  const id = positionals[0];
  if (!id || positionals.length > 1) {
    return usageError("usage: hw review show <id> [--json]");
  }

  const result = await deps.client.getReview(id);
  if (!result.ok) return clientErrorResult(result.error);

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatReviewShow(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
