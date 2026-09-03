import { flagBool, flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import { formatStatus } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  EXIT_OK,
  EXIT_UNREACHABLE,
  usageError,
} from "./types";

/** `hw status [--worktree <path>] [--json]` */
export async function statusCommand(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json"], string: ["worktree"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(`hw status takes no positional arguments, got: ${positionals.join(" ")}`);
  }

  const worktreeFlag = flagString(flags, "worktree");
  const ctx = await resolveContext({
    worktreeFlag,
    env: deps.env,
    cwd: deps.cwd,
    client: deps.client,
  });
  const healthResult = await deps.client.health();
  const health = healthResult.ok ? healthResult.value : null;

  if (flagBool(flags, "json")) {
    const stdout = `${JSON.stringify({ health, ...ctx }, null, 2)}\n`;
    return { exitCode: health ? EXIT_OK : EXIT_UNREACHABLE, stdout };
  }

  const stdout = `${formatStatus({ health, ...ctx })}\n`;
  return { exitCode: health ? EXIT_OK : EXIT_UNREACHABLE, stdout };
}
