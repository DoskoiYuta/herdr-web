import type { Decision, DecisionEvent, DecisionStatus } from "../../contract/decision";

export type DecisionListFilter = {
  status?: DecisionStatus[];
  worktreeRoot?: string;
};

export interface DecisionRepository {
  get(id: string): Promise<Decision | null>;
  list(filter: DecisionListFilter): Promise<Decision[]>;
  save(decision: Decision): Promise<void>;
}

export type DeliverResult = {
  state: "sent" | "agent_blocked" | "gone" | "unknown";
  pane: string | null;
};

/** `agent.prompt` 配達。pane が無い/存在しなければ `gone`。 */
export interface DecisionNotifier {
  deliver(paneId: string | null, text: string): Promise<DeliverResult>;
}

/** 作成時の呼び出し元解決 (`/api/hw/whoami` と同じ, F13-3)。pane が無ければ null。 */
export interface WhoamiResolver {
  resolve(
    paneId: string,
  ): Promise<{ worktreeRoot: string | null; repoKey: string | null; agent: string | null } | null>;
}

export interface Clock {
  now(): Date;
}

export type TimerHandle = { id: number };

export interface Timer {
  setTimeout(cb: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface DecisionEvents {
  emit(e: DecisionEvent): void;
}
