/** `/ws/events` decision メッセージのフィルタ、reviewEvent.ts / askEvent.ts と同じ発想。 */
import type { DecisionEvent } from "@contract/decision";

export type { DecisionEvent };

/** `worktreeRoot` が未解決なら「絞らない」側に倒す。 */
export function decisionEventMatchesWorktree(
  event: DecisionEvent,
  worktreeRoot: string | null,
): boolean {
  if (!worktreeRoot) return true;
  return event.worktreeRoot === worktreeRoot;
}
