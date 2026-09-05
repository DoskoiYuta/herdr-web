import { err, ok, type Result } from "neverthrow";
import type { AskSession, AskSessionStatus } from "../../contract/ask";
import type { PaneInfo, WorkspaceInfo } from "../../contract/herdr";
import type { AskSessionLauncher, LaunchError, PromptError } from "../ask/ports";
import type { HerdrGateway } from "./gateway";
import type { HerdrStateStore } from "./state";

export const ASK_WORKSPACE_LABEL_PREFIX = "ask:";

const SHELL_READY_RETRIES = 20;
const SHELL_READY_RETRY_MS = 500;

/** Retry `fn` while its error mentions `transientCode`, up to a few seconds; other errors rethrow tagged with `step`. */
async function retryWhile<T>(
  fn: () => Promise<T>,
  transientCode: string,
  step: string,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= SHELL_READY_RETRIES || !errorMessage(e).includes(transientCode)) {
        throw new Error(`${step}: ${errorMessage(e)}`);
      }
      await new Promise((r) => setTimeout(r, SHELL_READY_RETRY_MS));
    }
  }
}

export interface HerdrAskLauncherDeps {
  gateway: HerdrGateway;
  state: HerdrStateStore;
  config: { maxSessions: number };
  /** Directory containing an executable `hw` (see ensureHwShim), put on PATH for the ask pane's shell. */
  hwBinDir: string;
  /** The herdr-web server's own base URL, so `hw` inside the ask pane talks to this instance. */
  hwUrl: string;
  logger?: Pick<typeof console, "warn" | "error">;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function liveAskWorkspaceCount(state: HerdrStateStore): number {
  let count = 0;
  for (const ws of state.get().workspaces.values()) {
    if (ws.label.startsWith(ASK_WORKSPACE_LABEL_PREFIX)) count += 1;
  }
  return count;
}

/**
 * herdr's ids are not durable across compaction (closing workspaces packs the
 * remaining ones onto reused ids), so a `kind: "herdr"` session is never kept
 * by id — every operation re-finds the workspace by its exact `label` in the
 * current state and takes that workspace's first pane (the one `agent.start`
 * launched claude in).
 */
function findWorkspaceByLabel(state: HerdrStateStore, label: string): WorkspaceInfo | null {
  for (const ws of state.get().workspaces.values()) {
    if (ws.label === label) return ws;
  }
  return null;
}

function firstPaneOf(state: HerdrStateStore, workspaceId: string): PaneInfo | null {
  for (const pane of state.get().panes.values()) {
    if (pane.workspace_id === workspaceId) return pane;
  }
  return null;
}

/** Resolves a session to its live pane, or `"gone"` if the workspace/pane no longer exists. */
function resolvePane(state: HerdrStateStore, session: AskSession): PaneInfo | "gone" {
  if (session.kind === "pane") {
    return state.get().panes.get(session.paneId) ?? "gone";
  }
  const ws = findWorkspaceByLabel(state, session.label);
  if (!ws) return "gone";
  return firstPaneOf(state, ws.workspace_id) ?? "gone";
}

export function createHerdrAskLauncher(deps: HerdrAskLauncherDeps): AskSessionLauncher {
  const { gateway, state, config, hwBinDir, hwUrl } = deps;
  const logger = deps.logger ?? console;

  return {
    async start(params): Promise<Result<AskSession, LaunchError>> {
      if (liveAskWorkspaceCount(state) >= config.maxSessions) {
        return err({ type: "limit_reached", limit: config.maxSessions });
      }
      if (!gateway.status().connected) {
        return err({ type: "herdr_unavailable" });
      }

      let workspace: WorkspaceInfo;
      try {
        workspace = await gateway.workspaceCreate({
          cwd: params.worktreeRoot,
          label: params.label,
          focus: false,
          env: { PATH: `${hwBinDir}:${process.env.PATH ?? ""}`, HW_URL: hwUrl },
        });
      } catch (e) {
        return err({ type: "failed", message: errorMessage(e) });
      }

      try {
        const panes = await gateway.paneList(workspace.workspace_id);
        const pane = panes[0];
        if (!pane) throw new Error(`workspace.create left no pane for ${workspace.workspace_id}`);

        // herdr addresses named agents by name across the whole server, so the
        // name must be unique per session — derive it from the label.
        // `workspace.create` returns before the new pane's shell reaches its
        // prompt; `agent.start` then fails with `agent_pane_busy`, so retry
        // that specific error for a few seconds.
        const startParams = {
          name: params.label.replace(":", "-"),
          kind: "claude",
          paneId: pane.pane_id,
          timeoutMs: 60_000,
        };
        await retryWhile(() => gateway.agentStart(startParams), "agent_pane_busy", "agent.start");
        // `agent.start` resolves once herdr has detected the agent, but the
        // agent only becomes a promptable "named agent" a moment later
        // (`agent_not_ready` until then).
        const outcome = await retryWhile(
          () => gateway.agentPrompt(pane.pane_id, params.prompt),
          "agent_not_ready",
          "agent.prompt",
        );
        if (outcome.status !== "sent") {
          throw new Error(`agent.prompt: ${outcome.status}`);
        }

        return ok({ kind: "herdr", label: params.label });
      } catch (e) {
        try {
          await gateway.workspaceClose(workspace.workspace_id);
        } catch (closeErr) {
          logger.warn(`ask-session: cleanup close failed for ${workspace.workspace_id}`, closeErr);
        }
        return err({ type: "failed", message: errorMessage(e) });
      }
    },

    async prompt(session, text): Promise<Result<void, PromptError>> {
      const pane = resolvePane(state, session);
      if (pane === "gone") return err({ type: "gone" });

      try {
        const outcome = await gateway.agentPrompt(pane.pane_id, text);
        if (outcome.status === "agent_blocked") return err({ type: "agent_blocked" });
        // "sent" and "agent_prompt_stalled" both mean herdr accepted the send
        // attempt (stalled just means no lifecycle change was observed within
        // herdr's own timeout) — resending here would risk a double-send.
        return ok(undefined);
      } catch (e) {
        return err({ type: "failed", message: errorMessage(e) });
      }
    },

    async status(session): Promise<AskSessionStatus> {
      const pane = resolvePane(state, session);
      if (pane === "gone") return "gone";
      return pane.agent_status;
    },

    async close(session): Promise<void> {
      if (session.kind === "pane") return; // existing pane: not ours to start/close
      const ws = findWorkspaceByLabel(state, session.label);
      if (!ws) return;
      try {
        await gateway.workspaceClose(ws.workspace_id);
      } catch (e) {
        logger.warn(`ask-session: close failed for ${ws.workspace_id}`, e);
      }
    },

    async focus(session): Promise<void> {
      const pane = resolvePane(state, session);
      if (pane === "gone") return;
      try {
        if (state.get().focusedWorkspaceId !== pane.workspace_id) {
          await gateway.workspaceFocus(pane.workspace_id);
        }
        await gateway.paneFocus(pane.pane_id);
      } catch (e) {
        logger.warn(`ask-session: focus failed for ${pane.pane_id}`, e);
      }
    },
  };
}
