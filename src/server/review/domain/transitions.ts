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
    draft: true,
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
    // まだ何も送信されていない — send() が呼ばれるまで通知対象ではない。
    notify: { state: "none", pane: null, at: null },
    createdAt: now,
    updatedAt: now,
  };
}

export type ReplyInput = { author: EntryAuthor; body: string; agentSession?: string | null };

/** seq は削除で欠番になっても再利用しない（クライアントが持つ seq が別エントリを指さないため） */
function nextSeq(review: Review): number {
  return review.thread.reduce((max, e) => Math.max(max, e.seq + 1), 0);
}

function hasSentUserEntry(review: Review): boolean {
  return review.thread.some((e) => e.author === "user" && !e.draft);
}

/**
 * 返信による状態遷移。
 *  - author=user: 下書きとして追加するだけ。status は一切変えない
 *    （送信は send() の役目）。どの status でも常に成功する。
 *  - author=agent: 即送信済みとして追加する。送信済みの user エントリが
 *    一つも無ければ agent には review が見えていないはずなので not_repliable。
 *    [status, agent] の遷移: open|replied -> replied、resolved|outdated -> not_repliable。
 */
export function reply(
  review: Review,
  input: ReplyInput,
  clock: Clock,
): Result<Review, DomainError> {
  const now = clock.now().toISOString();

  if (input.author === "user") {
    const entry: Entry = {
      seq: nextSeq(review),
      author: "user",
      body: input.body,
      at: now,
      agentSession: input.agentSession ?? null,
      draft: true,
    };
    return ok({ ...review, thread: [...review.thread, entry], updatedAt: now });
  }

  if (!hasSentUserEntry(review)) {
    return err(domainError("not_repliable", "agent cannot reply to a review with no sent entry"));
  }

  const nextStatus = match<ReviewStatus, ReviewStatus | null>(review.status)
    .with("open", () => "replied" as const)
    .with("replied", () => "replied" as const)
    .with("resolved", () => null)
    .with("outdated", () => null)
    .exhaustive();

  if (nextStatus === null) {
    return err(domainError("not_repliable", `agent cannot reply to a ${review.status} review`));
  }

  const entry: Entry = {
    seq: nextSeq(review),
    author: "agent",
    body: input.body,
    at: now,
    agentSession: input.agentSession ?? null,
    draft: false,
  };
  return ok({
    ...review,
    status: nextStatus,
    thread: [...review.thread, entry],
    updatedAt: now,
  });
}

/** `PUT /api/review/:id/draft/:seq` の本文差し替え。draft でないエントリは触れない。 */
export function editDraft(
  review: Review,
  seq: number,
  body: string,
  clock: Clock,
): Result<Review, DomainError> {
  const entry = review.thread.find((e) => e.seq === seq);
  if (!entry || !entry.draft) {
    return err(domainError("not_draft", `no draft entry at seq ${seq}`));
  }
  const now = clock.now().toISOString();
  const thread = review.thread.map((e) => (e.seq === seq ? { ...e, body, at: now } : e));
  return ok({ ...review, thread, updatedAt: now });
}

/**
 * `DELETE /api/review/:id/draft/:seq`。draft でないエントリは触れない。残りの seq はそのまま。
 * 結果として thread が空になった場合の review 自体の削除は呼び出し側（usecase）の責務。
 */
export function deleteDraft(
  review: Review,
  seq: number,
  clock: Clock,
): Result<Review, DomainError> {
  const entry = review.thread.find((e) => e.seq === seq);
  if (!entry || !entry.draft) {
    return err(domainError("not_draft", `no draft entry at seq ${seq}`));
  }
  const thread = review.thread.filter((e) => e.seq !== seq);
  return ok({ ...review, thread, updatedAt: clock.now().toISOString() });
}

/**
 * `POST /api/review/send` の対象 1 件分。すべての下書きエントリを送信済みにし、
 * status を確定する: open/replied/resolved -> open（resolved は send で再オープン
 * される）、outdated -> outdated のまま。下書きが一つも無ければ no_drafts。
 */
export function send(review: Review, clock: Clock): Result<Review, DomainError> {
  if (!review.thread.some((e) => e.draft)) {
    return err(domainError("no_drafts", "review has no draft entries to send"));
  }
  const now = clock.now().toISOString();
  const thread = review.thread.map((e) => (e.draft ? { ...e, draft: false, at: now } : e));
  const status: ReviewStatus = review.status === "outdated" ? "outdated" : "open";
  return ok({
    ...review,
    thread,
    status,
    notify: { state: "pending", pane: null, at: null },
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

/** worktree 付きレビューが git mv でリネームされたファイルを追いかける (F10)。status は変えない。 */
export function moveToPath(
  review: Review,
  newPath: string,
  clock: Clock,
): Result<Review, DomainError> {
  if (review.target.kind !== "worktree") {
    return err(domainError("not_outdatable", "only worktree-bound reviews can follow a rename"));
  }
  return ok({ ...review, path: newPath, updatedAt: clock.now().toISOString() });
}
