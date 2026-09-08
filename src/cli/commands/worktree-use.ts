import { isAbsolute, resolve as resolvePath } from "node:path";
import { flagString, parseArgs } from "../args";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  EXIT_USAGE,
  usageError,
} from "./types";

/** `hw worktree use [<path>] [--pane <id>]` (path defaults to cwd; pane defaults to $HERDR_PANE_ID). */
export async function worktreeUseCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { string: ["pane"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  const [path, ...extra] = positionals;
  if (extra.length > 0) {
    return usageError(
      `hw worktree use takes at most one positional argument, got: ${positionals.join(" ")}`,
    );
  }

  const paneId = flagString(flags, "pane") ?? deps.env.HERDR_PANE_ID ?? null;
  if (!paneId) {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: "usage: hw worktree use [<path>] --pane <id>  (or set $HERDR_PANE_ID)\n",
    };
  }

  const rawRoot = path ?? deps.cwd;
  const root = isAbsolute(rawRoot) ? rawRoot : resolvePath(deps.cwd, rawRoot);

  const result = await deps.client.setWorktreeOverride(paneId, root);
  if (!result.ok) return clientErrorResult(result.error);
  return { exitCode: EXIT_OK, stdout: `worktree: ${result.value.root}\n` };
}
