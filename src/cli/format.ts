import type { Health } from "../contract/health";
import type { Review } from "../contract/review";

/** First `n` chars of `s`, with any newlines collapsed to spaces first (for one-line summaries). */
function firstChars(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) : oneLine;
}

/** UUIDv7 の末尾 8 文字（ランダム部）。先頭はタイムスタンプで近接作成分が揃うため使わない */
export function shortId(id: string): string {
  return id.slice(-8);
}

export function formatTarget(review: Pick<Review, "target">): string {
  return review.target.kind === "worktree"
    ? "worktree"
    : `commit:${review.target.hash.slice(0, 7)}`;
}

function formatLineRange(anchor: Review["anchor"]): string {
  const start = anchor.lineHint;
  if (anchor.lines.length <= 1) return `${start}`;
  return `${start}-${start + anchor.lines.length - 1}`;
}

/** `<id-short(8)> <status> <path>:<anchor.lineHint>[-<end>] [<target>] <first 60 chars of thread[0].body>` */
export function formatReviewLine(review: Review): string {
  const firstBody = review.thread[0]?.body ?? "";
  return `${shortId(review.id)} ${review.status} ${review.path}:${formatLineRange(review.anchor)} [${formatTarget(review)}] ${firstChars(firstBody, 60)}`;
}

export function formatReviewList(reviews: Review[]): string {
  const lines = reviews.map(formatReviewLine);
  lines.push(`${reviews.length} 件`);
  return lines.join("\n");
}

export function formatReviewShow(review: Review): string {
  const lines: string[] = [];
  lines.push(`id: ${review.id}`);
  lines.push(`repo: ${review.repo}`);
  lines.push(`path: ${review.path}`);
  lines.push(`status: ${review.status}`);
  lines.push(`target: ${formatTarget(review)}`);
  lines.push(`worktreeRoot: ${review.worktreeRoot}`);
  lines.push(`createdAt: ${review.createdAt}`);
  lines.push(`updatedAt: ${review.updatedAt}`);
  lines.push("");
  lines.push("anchor:");
  for (const before of review.anchor.before) {
    lines.push(`    ${before}`);
  }
  for (const anchorLine of review.anchor.lines) {
    lines.push(`  > ${anchorLine}`);
  }
  for (const after of review.anchor.after) {
    lines.push(`    ${after}`);
  }
  lines.push("");
  lines.push("thread:");
  for (const entry of review.thread) {
    const who = entry.agentSession ? `${entry.author} (${entry.agentSession})` : entry.author;
    lines.push(`[${who}] ${entry.at}`);
    for (const bodyLine of entry.body.split("\n")) {
      lines.push(`  ${bodyLine}`);
    }
  }
  return lines.join("\n");
}

export type StatusInfo = {
  health: Health | null;
  worktreeRoot: string | null;
  repoKey: string | null;
  sessionKey: string | null;
};

export function formatStatus(info: StatusInfo): string {
  const lines: string[] = [];
  lines.push(
    info.health
      ? `server: ok (v${info.health.version}, herdr ${info.health.herdr.connected ? `connected (protocol ${info.health.herdr.protocol})` : "disconnected"})`
      : "server: unreachable",
  );
  lines.push(`worktree: ${info.worktreeRoot ?? "(unknown)"}`);
  lines.push(`repo: ${info.repoKey ?? "(unknown)"}`);
  lines.push(`session: ${info.sessionKey ?? "(none)"}`);
  return lines.join("\n");
}
