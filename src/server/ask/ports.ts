import type { Result } from "neverthrow";
import type { Ask, AskSession, AskSessionStatus, AskStatus } from "../../contract/ask";

export type AskListFilter = {
  repo?: string;
  worktreeRoot?: string;
  status?: AskStatus[];
  path?: string;
};

export interface AskRepository {
  get(id: string): Promise<Ask | null>;
  list(filter: AskListFilter): Promise<Ask[]>;
  save(ask: Ask): Promise<void>;
}

export type LaunchError =
  | { type: "herdr_unavailable" }
  | { type: "limit_reached"; limit: number }
  | { type: "failed"; message: string };

export type PromptError =
  | { type: "agent_blocked" }
  | { type: "gone" }
  | { type: "failed"; message: string };

/**
 * 質問に答えるエージェントセッションの操作。実装は herdr（src/server/herdr/ask-session.ts）。
 * `AskSession.kind === "herdr"` は `label` で毎回 workspace を引き直す（id は詰められて変わる）。
 * `kind === "pane"` は既存 pane なので start/close はしない。
 */
export interface AskSessionLauncher {
  /** 専用 workspace を作り claude を起動して `prompt` を送る。成功で `{ kind: "herdr", label }`。 */
  start(params: {
    askId: string;
    worktreeRoot: string;
    label: string;
    prompt: string;
  }): Promise<Result<AskSession, LaunchError>>;
  /** そのセッションの pane に `agent.prompt` を 1 回送る。 */
  prompt(session: AskSession, text: string): Promise<Result<void, PromptError>>;
  status(session: AskSession): Promise<AskSessionStatus>;
  /** herdr kind: `workspace.close`。pane kind / 既に無い: no-op。 */
  close(session: AskSession): Promise<void>;
  /** 「herdr で開く」: pane.focus（必要なら workspace.focus を先に）。 */
  focus(session: AskSession): Promise<void>;
}
