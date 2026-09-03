import { reviewListCommand } from "./commands/list";
import { repoMoveCommand } from "./commands/repo-move";
import { reviewReplyCommand } from "./commands/reply";
import { reviewShowCommand } from "./commands/show";
import { statusCommand } from "./commands/status";
import { type CommandDeps, type CommandResult, EXIT_OK, usageError } from "./commands/types";

export const HELP_TEXT = `hw — herdr-web review CLI (plan §7 F6)

Usage:
  hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--path <p>] [--worktree <path>] [--json]
  hw review show <id> [--json]
  hw review reply <id> <text...>
  hw status [--worktree <path>] [--json]
  hw repo move <old-path> <new-path>
  hw --help

Env:
  HW_URL            server base URL (default http://127.0.0.1:8080)
  HERDR_PANE_ID      pane id used to resolve the current worktree via /api/hw/whoami

Exit codes: 0 ok, 1 usage error, 2 server unreachable, 3 not found / domain error.
`;

const REVIEW_HELP_TEXT = `hw review — manage reviews on the current worktree

Usage:
  hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--path <p>] [--worktree <path>] [--json]
  hw review show <id> [--json]
  hw review reply <id> <text...>
`;

function helpResult(text: string): CommandResult {
  return { exitCode: EXIT_OK, stdout: text };
}

/** Dispatches parsed top-level argv to the right subcommand. Pure aside from `deps`. */
export async function runCli(argv: string[], deps: CommandDeps): Promise<CommandResult> {
  const [head, ...rest] = argv;

  if (head === undefined || head === "--help" || head === "-h") {
    return helpResult(HELP_TEXT);
  }

  if (head === "review") {
    const [sub, ...subArgv] = rest;
    if (sub === undefined || sub === "--help" || sub === "-h") {
      return helpResult(REVIEW_HELP_TEXT);
    }
    if (sub === "list") return reviewListCommand(subArgv, deps);
    if (sub === "show") return reviewShowCommand(subArgv, deps);
    if (sub === "reply") return reviewReplyCommand(subArgv, deps);
    return usageError(`unknown subcommand: hw review ${sub}`);
  }

  if (head === "status") return statusCommand(rest, deps);

  if (head === "repo") {
    const [sub, ...subArgv] = rest;
    if (sub === "move") return repoMoveCommand(subArgv, deps);
    return usageError(`unknown subcommand: hw repo ${sub ?? ""}`.trimEnd());
  }

  return usageError(`unknown command: ${head}`);
}
