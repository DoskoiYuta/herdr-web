/**
 * `repo` extraction for `/ws/events` review/review-notify messages, so WS
 * fan-out (plan cross-cutting fix #5) can be filtered to the repo currently
 * on screen instead of triggering a refetch for every repo herdr happens to
 * be watching. `ReviewMessage.review` is now the full, typed `Review` shape
 * (src/contract/events.ts), so this just reads `review.repo` directly — a
 * `review-notify` event carries no review payload at all, so its repo is
 * unknowable.
 */
import type { ReviewEvent } from "./herdrStore";

/** The `repo` a review event concerns, or null if it can't be determined
 * (a `review-notify` event, which carries no review payload). */
export function reviewEventRepo(event: ReviewEvent): string | null {
  return event.type === "review" ? event.review.repo : null;
}

/**
 * Whether `event` should be treated as relevant to `repoKey` — i.e. NOT
 * filtered out. Errs toward "don't filter" whenever the repo can't be
 * determined (repoKey not yet resolved, or the event's own repo is
 * unknowable, e.g. review-notify), so a real update is never dropped by
 * mistake.
 */
export function reviewEventMatchesRepo(event: ReviewEvent, repoKey: string | null): boolean {
  if (!repoKey) return true;
  const eventRepo = reviewEventRepo(event);
  if (eventRepo === null) return true;
  return eventRepo === repoKey;
}
