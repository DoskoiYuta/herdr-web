import { flagBool, parseArgs } from "../args";
import { formatDecisionShow } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_DOMAIN,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw decision show <id> [--json]` */
export async function decisionShowCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;

  const id = positionals[0];
  if (!id || positionals.length > 1) {
    return usageError("usage: hw decision show <id> [--json]");
  }

  const result = await deps.client.getDecision(id);
  if (!result.ok) {
    if (result.error.kind === "http" && result.error.type === "ambiguous") {
      return {
        exitCode: EXIT_DOMAIN,
        stdout: "ambiguous id, use a longer suffix or the full id\n",
      };
    }
    return clientErrorResult(result.error);
  }

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatDecisionShow(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
