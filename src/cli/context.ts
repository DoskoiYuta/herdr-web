import type { HwClient } from "./client";
import { resolveLocalGit } from "./git";

export type ResolvedContext = {
  worktreeRoot: string | null;
  repoKey: string | null;
  /** `${source}:${kind}:${value}` from whoami's agentSession, else null (plan §6.5 notify / F6). */
  sessionKey: string | null;
  /** True when nothing is saved for the pane's (workspace, repoKey) — only meaningful via `$HERDR_PANE_ID` (ui-redesign.md §10). */
  selectionIsDefault: boolean;
};

export type ResolveContextInput = {
  /** `--worktree <path>` flag, if given. */
  worktreeFlag: string | null;
  env: Record<string, string | undefined>;
  cwd: string;
  client: HwClient;
};

/**
 * "Where am I" resolution per plan §6.5/F6-2: `--worktree` wins, else
 * `$HERDR_PANE_ID` via `/api/hw/whoami`, else `process.cwd()`. The first and
 * last case are normalised through local `git rev-parse`; the whoami case
 * trusts the server's resolution (it already ran the same git commands).
 */
export async function resolveContext(input: ResolveContextInput): Promise<ResolvedContext> {
  if (input.worktreeFlag) {
    const info = await resolveLocalGit(input.worktreeFlag);
    return {
      worktreeRoot: info?.root ?? input.worktreeFlag,
      repoKey: info?.repoKey ?? null,
      sessionKey: null,
      selectionIsDefault: false,
    };
  }

  const paneId = input.env.HERDR_PANE_ID;
  if (paneId) {
    const res = await input.client.whoami(paneId);
    if (res.ok) {
      const agentSession = res.value.agentSession;
      const sessionKey = agentSession
        ? `${agentSession.source}:${agentSession.kind}:${agentSession.value}`
        : null;
      return {
        worktreeRoot: res.value.worktreeRoot,
        repoKey: res.value.repoKey,
        sessionKey,
        selectionIsDefault: res.value.selectionIsDefault,
      };
    }
    // whoami unreachable/failed — fall back to cwd resolution below.
  }

  const info = await resolveLocalGit(input.cwd);
  return {
    worktreeRoot: info?.root ?? null,
    repoKey: info?.repoKey ?? null,
    sessionKey: null,
    selectionIsDefault: false,
  };
}
