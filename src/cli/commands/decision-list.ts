import { DecisionStatusSchema } from "../../contract/decision";
import { flagBool, flagString, parseArgs } from "../args";
import { resolveContext } from "../context";
import { formatDecisionList } from "../format";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  usageError,
} from "./types";

const KNOWN_STATUSES = new Set<string>(DecisionStatusSchema.options);

/** `hw decision list [--status <s1,s2>|all] [--worktree <path>] [--json]`。既定は open のみ。 */
export async function decisionListCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { boolean: ["json"], string: ["status", "worktree"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(
      `hw decision list takes no positional arguments, got: ${positionals.join(" ")}`,
    );
  }

  const statusFlag = flagString(flags, "status");
  if (statusFlag && statusFlag !== "all") {
    const unknown = statusFlag.split(",").filter((s) => s && !KNOWN_STATUSES.has(s));
    if (unknown.length > 0) {
      return usageError(`unknown status: ${unknown.join(", ")}`);
    }
  }
  const status = statusFlag === "all" ? undefined : (statusFlag ?? "open");

  const worktreeFlag = flagString(flags, "worktree");
  const ctx = await resolveContext({
    worktreeFlag,
    env: deps.env,
    cwd: deps.cwd,
    client: deps.client,
  });

  const result = await deps.client.listDecisions({
    status,
    worktreeRoot: ctx.worktreeRoot ?? undefined,
  });
  if (!result.ok) return clientErrorResult(result.error);

  const stdout = flagBool(flags, "json")
    ? `${JSON.stringify(result.value, null, 2)}\n`
    : `${formatDecisionList(result.value)}\n`;
  return { exitCode: EXIT_OK, stdout };
}
