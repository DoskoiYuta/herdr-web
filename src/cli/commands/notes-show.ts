import { flagBool, parseArgs } from "../args";
import { formatNoteShow } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_DOMAIN,
  EXIT_OK,
  usageError,
} from "./types";

/** `hw notes show <id> [--json] [--no-metadata]` */
export async function notesShowCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json", "no-metadata"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;

  const id = positionals[0];
  if (!id || positionals.length > 1) {
    return usageError("usage: hw notes show <id> [--json] [--no-metadata]");
  }
  if (flagBool(flags, "no-metadata") && flagBool(flags, "json")) {
    return usageError("--no-metadata cannot be combined with --json");
  }

  const result = await deps.client.getNote(id);
  if (!result.ok) {
    if (result.error.kind === "http" && result.error.type === "ambiguous") {
      return {
        exitCode: EXIT_DOMAIN,
        stdout: "ambiguous id, use a longer suffix or the full id\n",
      };
    }
    return clientErrorResult(result.error);
  }

  let stdout: string;
  if (flagBool(flags, "no-metadata")) {
    stdout = `${result.value.body}\n`;
  } else if (flagBool(flags, "json")) {
    stdout = `${JSON.stringify(result.value, null, 2)}\n`;
  } else {
    stdout = `${formatNoteShow(result.value)}\n`;
  }
  return { exitCode: EXIT_OK, stdout };
}
