import { flagString, parseArgs } from "../args";
import { resolveLocalGit } from "../git";
import { type CommandDeps, type CommandResult, EXIT_OK } from "./types";

type HookJson = {
  tool_name?: unknown;
  tool_response?: unknown;
  cwd?: unknown;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `tool_response`'s shape isn't documented for `EnterWorktree` — try the keys a
 * worktree-shaped response is likely to carry, in order, before falling back to
 * a bare string response (grabbing its first absolute path).
 */
function extractFromToolResponse(response: unknown): string | null {
  if (response == null) return null;
  if (typeof response === "object") {
    const obj = response as Record<string, unknown>;
    for (const key of ["path", "worktreePath", "cwd"]) {
      const value = obj[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  }
  if (typeof response === "string") {
    const match = response.match(/\/\S+/);
    return match ? match[0] : null;
  }
  return null;
}

/**
 * Path to declare as the worktree for an `EnterWorktree` hook event, or null if
 * none can be found.
 *
 * Claude Code's hook `cwd` DOES follow `EnterWorktree` (unlike a shell hook's
 * cwd, which historically didn't) — so it's tried first, and only trusted if
 * it actually resolves as a git repo (`isGitPath`), since a stale or
 * unrelated `cwd` must not get declared as the worktree. `tool_response` is
 * the fallback for whichever of its shapes we can find a path in.
 */
export async function extractWorktreePath(
  hook: HookJson,
  isGitPath: (path: string) => Promise<boolean> = async (path) =>
    (await resolveLocalGit(path)) !== null,
): Promise<string | null> {
  const hookCwd = typeof hook.cwd === "string" ? hook.cwd : null;
  if (hookCwd && (await isGitPath(hookCwd))) return hookCwd;
  return extractFromToolResponse(hook.tool_response);
}

/**
 * `hw worktree sync` — invoked from a Claude Code `PostToolUse` hook
 * (matcher `EnterWorktree|ExitWorktree`) so `hw worktree use/clear` tracks
 * `EnterWorktree`/`ExitWorktree` automatically. Every exit is 0: a hook
 * failure must never block the agent's tool call, so problems (bad JSON, an
 * unresolvable path, the server being unreachable) are reported on stderr
 * only.
 */
export async function worktreeSyncCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { string: ["pane"] });
  if (!parsed.ok) {
    return { exitCode: EXIT_OK, stdout: "", stderr: `hw worktree sync: ${parsed.error}\n` };
  }
  const paneId = flagString(parsed.value.flags, "pane") ?? deps.env.HERDR_PANE_ID ?? null;
  if (!paneId) {
    return {
      exitCode: EXIT_OK,
      stdout: "",
      stderr: "hw worktree sync: no pane (missing --pane / $HERDR_PANE_ID)\n",
    };
  }

  let hook: HookJson;
  try {
    const raw = await deps.readStdin();
    const parsedJson: unknown = JSON.parse(raw);
    if (!parsedJson || typeof parsedJson !== "object") {
      throw new Error("hook JSON is not an object");
    }
    hook = parsedJson as HookJson;
  } catch (err) {
    return { exitCode: EXIT_OK, stdout: "", stderr: `hw worktree sync: ${errorMessage(err)}\n` };
  }

  if (hook.tool_name === "EnterWorktree") {
    const path = await extractWorktreePath(hook);
    if (!path) return { exitCode: EXIT_OK, stdout: "" };
    const result = await deps.client.setWorktreeOverride(paneId, path);
    if (!result.ok) {
      return {
        exitCode: EXIT_OK,
        stdout: "",
        stderr: `hw worktree sync: ${result.error.message}\n`,
      };
    }
    return { exitCode: EXIT_OK, stdout: `worktree: ${result.value.root}\n` };
  }

  if (hook.tool_name === "ExitWorktree") {
    const result = await deps.client.clearWorktreeOverride(paneId);
    if (!result.ok) {
      return {
        exitCode: EXIT_OK,
        stdout: "",
        stderr: `hw worktree sync: ${result.error.message}\n`,
      };
    }
    return { exitCode: EXIT_OK, stdout: `worktree: ${result.value.root ?? "(unknown)"}\n` };
  }

  return { exitCode: EXIT_OK, stdout: "" };
}
