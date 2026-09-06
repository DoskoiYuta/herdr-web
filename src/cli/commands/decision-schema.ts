import { decisionSpecJsonSchema } from "../../contract/decision";
import { parseArgs } from "../args";
import { type CommandDeps, type CommandResult, EXIT_OK, usageError } from "./types";

/** `hw decision schema` — spec の JSON Schema を出す。ローカルの契約から生成するので herdr-web への接続を必要としない。 */
export async function decisionSchemaCommand(
  argv: string[],
  _deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, {});
  if (!parsed.ok) return usageError(parsed.error);
  if (parsed.value.positionals.length > 0) return usageError("usage: hw decision schema");

  return { exitCode: EXIT_OK, stdout: `${JSON.stringify(decisionSpecJsonSchema(), null, 2)}\n` };
}
