import { askListCommand } from "./commands/ask-list";
import { askReplyCommand } from "./commands/ask-reply";
import { askShowCommand } from "./commands/ask-show";
import { decisionCancelCommand } from "./commands/decision-cancel";
import { decisionListCommand } from "./commands/decision-list";
import { decisionRequestCommand } from "./commands/decision-request";
import { decisionSchemaCommand } from "./commands/decision-schema";
import { decisionShowCommand } from "./commands/decision-show";
import { reviewListCommand } from "./commands/list";
import { repoMoveCommand } from "./commands/repo-move";
import { reviewReplyCommand } from "./commands/reply";
import { reviewShowCommand } from "./commands/show";
import { statusCommand } from "./commands/status";
import { type CommandDeps, type CommandResult, EXIT_OK, usageError } from "./commands/types";

export const HELP_TEXT = `hw — herdr-web review CLI (plan §7 F6, F10)

Usage:
  hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--path <p>] [--worktree <path>] [--json]
  hw review show <id> [--json]   (<id> may be the short id printed by 'hw review list')
  hw review reply <id> <text...>
  hw ask list [--all] [--path <p>] [--worktree <path>] [--json]
  hw ask show <id> [--json]   (<id> may be the short id printed by 'hw ask list')
  hw ask reply <id> <text...>
  hw decision request [--file d.json | stdin] [--pane <id>]
  hw decision show <id> [--json]   (<id> may be the short id printed by 'hw decision list')
  hw decision list [--status <s1,s2>|all] [--worktree <path>] [--json]  (既定: open のみ)
  hw decision cancel <id>
  hw decision schema
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
  hw review show <id> [--json]   (<id> may be the short id printed by 'hw review list')
  hw review reply <id> <text...>
`;

const ASK_HELP_TEXT = `hw ask — answer 質問 (F10) attached to a place in the code

Usage:
  hw ask list [--all] [--path <p>] [--worktree <path>] [--json]
  hw ask show <id> [--json]   (<id> may be the short id printed by 'hw ask list')
  hw ask reply <id> <text...>
`;

const DECISION_HELP_TEXT = `hw decision — ask a human to decide something (F13)

Usage:
  hw decision request [--file d.json | stdin] [--pane <id>]
  hw decision show <id> [--json]   (<id> may be the short id printed by 'hw decision list')
  hw decision list [--status <s1,s2>|all] [--worktree <path>] [--json]  (既定: open のみ)
  hw decision cancel <id>
  hw decision schema
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

  if (head === "ask") {
    const [sub, ...subArgv] = rest;
    if (sub === undefined || sub === "--help" || sub === "-h") {
      return helpResult(ASK_HELP_TEXT);
    }
    if (sub === "list") return askListCommand(subArgv, deps);
    if (sub === "show") return askShowCommand(subArgv, deps);
    if (sub === "reply") return askReplyCommand(subArgv, deps);
    return usageError(`unknown subcommand: hw ask ${sub}`);
  }

  if (head === "decision") {
    const [sub, ...subArgv] = rest;
    if (sub === undefined || sub === "--help" || sub === "-h") {
      return helpResult(DECISION_HELP_TEXT);
    }
    if (sub === "request") return decisionRequestCommand(subArgv, deps);
    if (sub === "show") return decisionShowCommand(subArgv, deps);
    if (sub === "list") return decisionListCommand(subArgv, deps);
    if (sub === "cancel") return decisionCancelCommand(subArgv, deps);
    if (sub === "schema") return decisionSchemaCommand(subArgv, deps);
    return usageError(`unknown subcommand: hw decision ${sub}`);
  }

  if (head === "status") return statusCommand(rest, deps);

  if (head === "repo") {
    const [sub, ...subArgv] = rest;
    if (sub === "move") return repoMoveCommand(subArgv, deps);
    return usageError(`unknown subcommand: hw repo ${sub ?? ""}`.trimEnd());
  }

  return usageError(`unknown command: ${head}`);
}
