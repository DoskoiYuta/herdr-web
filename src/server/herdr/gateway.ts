import type {
  PaneInfo,
  PaneLayoutSnapshot,
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
  /**
   * `workspace.create`: creates a workspace rooted at `cwd`, optionally
   * labeled and focused. `env` is merged into the environment of the shell
   * herdr starts in the workspace's root pane.
   */
  workspaceCreate(params: {
    cwd: string | null;
    label?: string | null;
    focus?: boolean;
    env?: Record<string, string>;
  }): Promise<WorkspaceInfo>;
  /** `workspace.rename`. */
  workspaceRename(workspaceId: string, label: string): Promise<WorkspaceInfo>;
  /**
   * `workspace.close`. Kills the workspace's panes (and any agents running in
   * them) — callers must confirm with the user before calling this.
   */
  workspaceClose(workspaceId: string): Promise<void>;
  agentPrompt(paneId: string, text: string): Promise<AgentPromptOutcome>;
  /** `notification.show`: a desktop toast, independent of any pane (plan.md F13-11). */
  notificationShow(params: {
    title: string;
    body?: string | null;
    sound?: "none" | "done" | "request";
  }): Promise<void>;
  /**
   * `agent.start`: launches an agent in `paneId`, which must be at a shell
   * prompt. Resolves once herdr detects the agent and it is ready (or rejects
   * on herdr's own startup timeout / a pane that isn't a bare shell).
   */
  agentStart(params: {
    name: string;
    kind: string;
    paneId: string;
    timeoutMs?: number;
    args?: string[];
  }): Promise<PaneInfo>;
  /** `pane.list`, optionally filtered to one workspace. */
  paneList(workspaceId?: string | null): Promise<PaneInfo[]>;
  /** `pane.layout`: the tab's split layout containing this pane. */
  paneLayout(paneId: string): Promise<PaneLayoutSnapshot>;
  /** `pane.read`: the pane's recent scrollback, ANSI stripped, as plain text. */
  paneRead(paneId: string, lines: number): Promise<string>;
  /** Subscribe to herdr events. Returns an unsubscribe function. Handlers are never allowed to throw out. */
  subscribe(handler: (event: HerdrEventEnvelope) => void): () => void;
  status(): HerdrStatus;
  onStatus(cb: (status: HerdrStatus) => void): () => void;
  close(): void;
}
