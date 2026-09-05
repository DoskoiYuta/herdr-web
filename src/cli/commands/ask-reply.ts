import { flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

/**
 * `hw ask reply <id> <text...>` — `text` is the remaining positionals
 * joined with a space, or `-` alone to read the body from stdin.
 */
export async function askReplyCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { string: ["worktree"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;

  const id = positionals[0];
  const textWords = positionals.slice(1);
  if (!id || textWords.length === 0) {
    return usageError(
      "usage: hw ask reply <id> <text...> (or `hw ask reply <id> -` to read stdin)",
    );
  }

  const body =
    textWords.length === 1 && textWords[0] === "-"
      ? (await deps.readStdin()).trim()
      : textWords.join(" ");
  if (body.length === 0) return usageError("reply body must not be empty");

  const worktreeFlag = flagString(flags, "worktree");
  const ctx = await resolveContext({
    worktreeFlag,
    env: deps.env,
    cwd: deps.cwd,
    client: deps.client,
  });

  const result = await deps.client.replyToAsk(id, body, ctx.sessionKey);
  if (!result.ok) return clientErrorResult(result.error);
  return { exitCode: EXIT_OK, stdout: `replied to ${id}\n` };
}
