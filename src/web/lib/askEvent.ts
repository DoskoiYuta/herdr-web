/**
 * `repo` extraction/filtering for `/ws/events` ask messages, mirroring
 * reviewEvent.ts.
 */
import type { AskEvent } from "@contract/ask";

export type { AskEvent };

/** The `repo` an ask event concerns. */
export function askEventRepo(event: AskEvent): string {
  return event.ask.repo;
}

/** Whether `event` should be treated as relevant to `repoKey` — errs toward
 * "don't filter" whenever `repoKey` isn't resolved yet. */
export function askEventMatchesRepo(event: AskEvent, repoKey: string | null): boolean {
  if (!repoKey) return true;
  return askEventRepo(event) === repoKey;
}
