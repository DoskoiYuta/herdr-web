import { err, ok, type Result } from "neverthrow";
import { match } from "ts-pattern";
import type {
  Anchor,
  Entry,
  EntryAuthor,
  Review,
  ReviewStatus,
  ReviewTarget,
  ViewedAs,
} from "../../../contract/review";
import type { Clock } from "./clock";
import { domainError, type DomainError } from "./errors";

export type CreateReviewInput = {
  id: string;
  repo: string;
  target: ReviewTarget;
  worktreeRoot: string;
  path: string;
  anchor: Anchor;
  createdAtHead: string;
  viewedAs: ViewedAs;
  body: string;
  agentSession?: string | null;
};

export function createReview(input: CreateReviewInput, clock: Clock): Review {
  const now = clock.now().toISOString();
  const entry: Entry = {
    seq: 0,
    author: "user",
    body: input.body,
    at: now,
    agentSession: input.agentSession ?? null,
  };
  return {
    id: input.id,
    repo: input.repo,
    target: input.target,
    worktreeRoot: input.worktreeRoot,
    path: input.path,
    anchor: input.anchor,
    createdAtHead: input.createdAtHead,
    viewedAs: input.viewedAs,
    status: "open",
    thread: [entry],
    createdAt: now,
    updatedAt: now,
  };
}

export type ReplyInput = { author: EntryAuthor; body: string; agentSession?: string | null };

/**
 * 返信による状態遷移。[status, author] の全マスを網羅する:
 *  - open|replied  + agent -> replied
 *  - open|replied  + user  -> open
 *  - resolved      + user  -> open (reopen)
 *  - resolved      + agent -> error not_repliable
 *  - outdated      + user  -> outdated のまま (append only)
 *  - outdated      + agent -> error not_repliable
 */
export function reply(
  review: Review,
  input: ReplyInput,
  clock: Clock,
): Result<Review, DomainError> {
  const nextStatus = match<[ReviewStatus, EntryAuthor], ReviewStatus | null>([
    review.status,
    input.author,
  ])
    .with(["open", "agent"], () => "replied" as const)
    .with(["replied", "agent"], () => "replied" as const)
    .with(["open", "user"], () => "open" as const)
    .with(["replied", "user"], () => "open" as const)
    .with(["resolved", "user"], () => "open" as const)
    .with(["resolved", "agent"], () => null)
    .with(["outdated", "user"], () => "outdated" as const)
    .with(["outdated", "agent"], () => null)
    .exhaustive();

  if (nextStatus === null) {
    return err(
      domainError("not_repliable", `${input.author} cannot reply to a ${review.status} review`),
    );
  }

  const now = clock.now().toISOString();
  const entry: Entry = {
    seq: review.thread.length,
    author: input.author,
    body: input.body,
    at: now,
    agentSession: input.agentSession ?? null,
  };
  return ok({
    ...review,
    status: nextStatus,
    thread: [...review.thread, entry],
    updatedAt: now,
  });
}

/** resolve は user のみが呼べる想定（ルート層で agent には出さない）。ドメインは author を取らない。 */
export function resolve(review: Review, clock: Clock): Result<Review, DomainError> {
  if (review.status === "resolved") {
    return err(domainError("already_resolved", "review is already resolved"));
  }
  return ok({ ...review, status: "resolved", updatedAt: clock.now().toISOString() });
}

/** worktree 付きレビューのみ outdated にできる。commit 付きは対象外 (F5-5)。 */
export function markOutdated(review: Review, clock: Clock): Result<Review, DomainError> {
  if (review.target.kind !== "worktree") {
    return err(domainError("not_outdatable", "commit-bound reviews are never outdated"));
  }
  if (review.status !== "open" && review.status !== "replied") {
    return err(domainError("not_outdatable", `cannot mark a ${review.status} review outdated`));
  }
  return ok({ ...review, status: "outdated", updatedAt: clock.now().toISOString() });
}

/** worktree 付きレビューを commit 付きに確定する。outdated だった場合は open に戻る。 */
export function reanchorToCommit(
  review: Review,
  hash: string,
  clock: Clock,
): Result<Review, DomainError> {
  if (review.target.kind !== "worktree") {
    return err(domainError("already_committed", "review is already commit-bound"));
  }
  const status: ReviewStatus = review.status === "outdated" ? "open" : review.status;
  return ok({
    ...review,
    target: { kind: "commit", hash },
    status,
    updatedAt: clock.now().toISOString(),
  });
}

/** outdated だった worktree 付きレビューを、user の手動再アンカー成功で open に戻す (F5-3)。 */
export function reopenFromOutdated(review: Review, clock: Clock): Result<Review, DomainError> {
  if (review.status !== "outdated") {
    return err(
      domainError("not_outdatable", `only outdated reviews can be reopened (was ${review.status})`),
    );
  }
  return ok({ ...review, status: "open", updatedAt: clock.now().toISOString() });
}

/** rebase/squash で別 commit に付け直す。commit 付きレビュー専用。status は変えない。 */
export function retargetCommit(
  review: Review,
  hash: string,
  clock: Clock,
): Result<Review, DomainError> {
  if (review.target.kind !== "commit") {
    return err(domainError("not_commit_bound", "review is not commit-bound"));
  }
  return ok({ ...review, target: { kind: "commit", hash }, updatedAt: clock.now().toISOString() });
}
