import { ok, type Result } from "neverthrow";
import type { AskSession, AskSessionStatus } from "../../../contract/ask";
import type { AskSessionLauncher, LaunchError, PromptError } from "../ports";

export type FakeLauncherCall =
  | {
      kind: "start";
      askId: string;
      worktreeRoot: string;
      label: string;
      prompt: string;
      agent: string;
    }
  | { kind: "prompt"; session: AskSession; text: string }
  | { kind: "status"; session: AskSession }
  | { kind: "close"; session: AskSession }
  | { kind: "focus"; session: AskSession };

export type FakeAskLauncherOptions = {
  startResult?: Result<AskSession, LaunchError>;
  promptResult?: Result<void, PromptError>;
  status?: AskSessionStatus;
};

/** テスト用の `AskSessionLauncher`。呼び出しをすべて `calls` に記録し、既定は常に成功する。 */
export function createFakeAskLauncher(options: FakeAskLauncherOptions = {}) {
  const calls: FakeLauncherCall[] = [];
  const launcher: AskSessionLauncher = {
    async start(params) {
      calls.push({ kind: "start", ...params });
      return options.startResult ?? ok({ kind: "herdr", label: params.label, agent: params.agent });
    },
    async prompt(session, text) {
      calls.push({ kind: "prompt", session, text });
      return options.promptResult ?? ok(undefined);
    },
    async status(session) {
      calls.push({ kind: "status", session });
      return options.status ?? "working";
    },
    async close(session) {
      calls.push({ kind: "close", session });
    },
    async focus(session) {
      calls.push({ kind: "focus", session });
    },
  };
  return { launcher, calls };
}
