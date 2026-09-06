import type { Ask, AskWithSession } from "../contract/ask";
import type { Decision } from "../contract/decision";
import type { Health } from "../contract/health";
import type { Anchor, Review } from "../contract/review";

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

function formatLineRange(anchor: Anchor): string {
  const start = anchor.lineHint;
  if (anchor.lines.length <= 1) return `${start}`;
  return `${start}-${start + anchor.lines.length - 1}`;
}

function formatAnchorBlock(anchor: Anchor): string[] {
  const lines: string[] = [];
  for (const before of anchor.before) lines.push(`    ${before}`);
  for (const anchorLine of anchor.lines) lines.push(`  > ${anchorLine}`);
  for (const after of anchor.after) lines.push(`    ${after}`);
  return lines;
}

function formatThread(
  thread: { author: string; agentSession: string | null; at: string; body: string }[],
): string[] {
  const lines: string[] = [];
  for (const entry of thread) {
    const who = entry.agentSession ? `${entry.author} (${entry.agentSession})` : entry.author;
    lines.push(`[${who}] ${entry.at}`);
    for (const bodyLine of entry.body.split("\n")) lines.push(`  ${bodyLine}`);
  }
  return lines;
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
  lines.push(...formatAnchorBlock(review.anchor));
  lines.push("");
  lines.push("thread:");
  lines.push(...formatThread(review.thread));
  return lines.join("\n");
}

/** `<id-short(8)> <status> <path>:<anchor.lineHint>[-<end>] <first 60 chars of thread[0].body>` */
export function formatAskLine(ask: Ask): string {
  const firstBody = ask.thread[0]?.body ?? "";
  return `${shortId(ask.id)} ${ask.status} ${ask.path}:${formatLineRange(ask.anchor)} ${firstChars(firstBody, 60)}`;
}

export function formatAskList(asks: Ask[]): string {
  const lines = asks.map(formatAskLine);
  lines.push(`${asks.length} 件`);
  return lines.join("\n");
}

export function formatAskShow(ask: AskWithSession): string {
  const lines: string[] = [];
  lines.push(`id: ${ask.id}`);
  lines.push(`repo: ${ask.repo}`);
  lines.push(`path: ${ask.path}`);
  lines.push(`status: ${ask.status}`);
  lines.push(`worktreeRoot: ${ask.worktreeRoot}`);
  lines.push(`session: ${ask.sessionStatus}`);
  lines.push(`createdAt: ${ask.createdAt}`);
  lines.push(`updatedAt: ${ask.updatedAt}`);
  lines.push("");
  lines.push("anchor:");
  lines.push(...formatAnchorBlock(ask.anchor));
  lines.push("");
  lines.push("thread:");
  lines.push(...formatThread(ask.thread));
  return lines.join("\n");
}

/** `<id-short(8)> <status> <title> [worktreeRoot]` */
export function formatDecisionLine(decision: Decision): string {
  const title = decision.spec.title ?? "(no title)";
  const where = decision.worktreeRoot ? ` [${decision.worktreeRoot}]` : "";
  return `${shortId(decision.id)} ${decision.status} ${firstChars(title, 60)}${where}`;
}

export function formatDecisionList(decisions: Decision[]): string {
  const lines = decisions.map(formatDecisionLine);
  lines.push(`${decisions.length} 件`);
  return lines.join("\n");
}

export function formatDecisionShow(decision: Decision): string {
  const lines: string[] = [];
  lines.push(`id: ${decision.id}`);
  lines.push(`status: ${decision.status}`);
  lines.push(`title: ${decision.spec.title ?? ""}`);
  lines.push(`worktreeRoot: ${decision.worktreeRoot ?? ""}`);
  lines.push(`agent: ${decision.agent ?? ""}`);
  lines.push(`pane: ${decision.paneId ?? ""}`);
  lines.push(`createdAt: ${decision.createdAt}`);
  if (decision.delivery) {
    lines.push(
      `delivery: ${decision.delivery.state} (pane ${decision.delivery.pane ?? "?"}, attempts ${decision.delivery.attempts})`,
    );
  }
  lines.push("");
  lines.push("items:");
  for (const item of decision.spec.items) {
    lines.push(`  [${item.id}] ${item.header} (${item.kind})`);
    lines.push(`    ${item.question}`);
    for (const opt of item.options) {
      lines.push(`    - ${opt.label}${opt.recommended ? " (recommended)" : ""}`);
    }
  }
  if (decision.answer) {
    lines.push("");
    lines.push("answer:");
    for (const [itemId, a] of Object.entries(decision.answer.answers)) {
      const selected = a.selected.length > 0 ? a.selected.join(",") : null;
      const choice =
        selected && a.other ? `${selected}（その他: ${a.other}）` : (selected ?? a.other ?? "");
      lines.push(`  ${itemId}=${choice}${a.note ? ` (note: ${a.note})` : ""}`);
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
