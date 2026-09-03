import type {
  PaneInfo,
  PingResult,
  SessionSnapshot,
  HerdrEventEnvelope,
  WorkspaceInfo,
} from "../../contract/herdr";

export type HerdrStatus = { connected: boolean; protocol: number | null };

/**
 * `agent.prompt`'s outcome. herdr rejects with the `agent_blocked` error code
 * (no send attempted) when the agent is sitting at an approval/question UI, and
 * with `agent_prompt_stalled` if a prompt from a non-working state produces no
 * observed lifecycle change within herdr's own timeout (plan.md §3, §6.5 F5-6).
 * Both are expected outcomes callers must branch on, not transport failures, so
 * the gateway resolves them rather than throwing.
 */
export type AgentPromptOutcome =
  | { status: "sent"; agent: PaneInfo }
  | { status: "agent_blocked" }
  | { status: "agent_prompt_stalled" };

/**
 * The port herdr-web talks to herdr through (plan.md §6.7, §9.5). Two
 * implementations: `socket-client.ts` (real, over the herdr unix socket) and
 * `fake.ts` (in-memory test double).
 */
export interface HerdrGateway {
  ping(): Promise<PingResult>;
  snapshot(): Promise<SessionSnapshot>;
  paneGet(paneId: string): Promise<PaneInfo>;
  paneFocus(paneId: string): Promise<PaneInfo>;
  workspaceFocus(workspaceId: string): Promise<void>;
  /** `workspace.create`: creates a workspace rooted at `cwd`, optionally labeled and focused. */
  workspaceCreate(params: {
    cwd: string | null;
    label?: string | null;
    focus?: boolean;
  }): Promise<WorkspaceInfo>;
  /** `workspace.rename`. */
  workspaceRename(workspaceId: string, label: string): Promise<WorkspaceInfo>;
  /**
   * `workspace.close`. Kills the workspace's panes (and any agents running in
   * them) — callers must confirm with the user before calling this.
   */
  workspaceClose(workspaceId: string): Promise<void>;
  agentPrompt(paneId: string, text: string): Promise<AgentPromptOutcome>;
  /** Subscribe to herdr events. Returns an unsubscribe function. Handlers are never allowed to throw out. */
  subscribe(handler: (event: HerdrEventEnvelope) => void): () => void;
  status(): HerdrStatus;
  onStatus(cb: (status: HerdrStatus) => void): () => void;
  close(): void;
}
