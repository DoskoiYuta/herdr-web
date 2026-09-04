import type { DomainError } from "../domain/errors";

export type NotFoundError = { type: "not_found"; message: string };

/** POST /api/review/send: `notifier.targetsAt` の結果と `pane` の食い違いを表す */
export type SendTargetError =
  | { type: "no_agent"; message: string }
  | { type: "ambiguous_target"; message: string; targets: string[] }
  | { type: "invalid_target"; message: string };

export type UsecaseError = DomainError | NotFoundError | SendTargetError;

export function notFound(message: string): NotFoundError {
  return { type: "not_found", message };
}

export function noAgent(worktreeRoot: string): SendTargetError {
  return { type: "no_agent", message: `no agent pane at ${worktreeRoot}` };
}

export function ambiguousTarget(targets: string[]): SendTargetError {
  return {
    type: "ambiguous_target",
    message: "multiple agent panes at the worktree; pane is required",
    targets,
  };
}

export function invalidTarget(pane: string): SendTargetError {
  return { type: "invalid_target", message: `pane ${pane} is not an agent target at the worktree` };
}
