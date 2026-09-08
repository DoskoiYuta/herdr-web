// Renders the two DiffLineAnnotation kinds F3-6/F5-8 attach to a diff line:
// the "new comment" composer (opened by selecting a line) and the inline
// thread(s) of reviews already anchored there. Kept separate from
// DiffPanel.tsx so both are unit-testable without mounting @pierre/diffs.
import { useLayoutEffect, useRef, useState } from "react";
import type { ForDiffMatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThreadCard } from "@/components/thread/ThreadCard";
import { deliveryOf, turnOf } from "@/lib/statusVocab";
import { observeReviewRange } from "./rangeHighlight";

export function ComposerAnnotation({
  onCancel,
  onSubmit,
  disabled = false,
}: {
  onCancel: () => void;
  onSubmit: (body: string) => void | Promise<void>;
  /** F5-1: `createdAtHead` hasn't resolved yet (gitApi.root() in flight) —
   * disable submit rather than sending an anchor with `createdAtHead: ""`. */
  disabled?: boolean;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim() || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-1 ml-8 flex flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-sm">
      <Textarea
        autoFocus
        placeholder="コメントを追加"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
        className="min-h-12 text-sm"
      />
      {disabled && (
        <p className="text-xs text-muted-foreground">
          HEAD を解決できていません（少し待ってから再度お試しください）
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          キャンセル
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || disabled || !body.trim()}
        >
          下書きを追加
        </Button>
      </div>
    </div>
  );
}

/** Review 固有のロジック（位置文字列・未送信下書き判定・配達の有無）を
 * `ThreadCard` の種別非依存な props へ写像する。API 呼び出しやポーリングは
 * 呼び出し側（DiffPanel）に残す。 */
export function ReviewThreadCard({
  match,
  range,
  onReply,
  onResolve,
  onReanchor,
  onResend,
  onEditDraft,
  onDeleteDraft,
}: {
  match: ForDiffMatch;
  /** Real (1-based) line numbers the anchor's range spans, for the
   * `L<start>–L<end>` label — only shown when it covers more than one line. */
  range?: { start: number; end: number };
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onReanchor: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
  onEditDraft: (id: string, seq: number, body: string) => void | Promise<void>;
  onDeleteDraft: (id: string, seq: number) => void | Promise<void>;
}) {
  const { review, confidence } = match;
  const dimmed = confidence === "line";
  const hasUnsentDraft = review.thread.some((e) => e.draft);
  const hasSentEntry = review.thread.some((e) => !e.draft);
  const lastEntry = review.thread[review.thread.length - 1];
  const [resendBusy, setResendBusy] = useState(false);

  const turn = turnOf("review", { status: review.status, hasUnsentDraft });
  const location =
    range && range.end > range.start
      ? `${review.path}:L${range.start}–L${range.end}`
      : `${review.path}:L${range?.start ?? review.anchor.lineHint}`;

  const handleResend = async () => {
    if (resendBusy) return;
    setResendBusy(true);
    try {
      await onResend(review.id);
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div data-testid="review-thread" className={dimmed ? "opacity-60" : ""}>
      <ThreadCard
        kind="review"
        location={location}
        turn={turn}
        delivery={
          hasSentEntry
            ? {
                ...deliveryOf("review", review.notify),
                onResend: handleResend,
                busy: resendBusy,
              }
            : undefined
        }
        unread={lastEntry?.author === "agent"}
        messages={review.thread.map((entry) => ({
          author: entry.author,
          at: entry.at,
          body: entry.body,
          draft: entry.draft,
          onEdit: entry.draft ? (body) => onEditDraft(review.id, entry.seq, body) : undefined,
          onDelete: entry.draft ? () => onDeleteDraft(review.id, entry.seq) : undefined,
        }))}
        reply={{
          placeholder: "返信を下書き…（⌘Enter）",
          onSubmit: (body) => onReply(review.id, body),
        }}
        actions={[
          ...(review.status === "outdated"
            ? [{ label: "再アンカー", onClick: () => onReanchor(review.id) }]
            : []),
          ...(review.status !== "resolved"
            ? [{ label: "解決", onClick: () => onResolve(review.id) }]
            : []),
        ]}
        positionEstimated={dimmed}
      />
    </div>
  );
}

export function ReviewsAnnotation({
  matches,
  ranges,
  onReply,
  onResolve,
  onReanchor,
  onResend,
  onEditDraft,
  onDeleteDraft,
}: {
  matches: ForDiffMatch[];
  /** Review id -> real line range, for `ReviewThreadCard`'s `L<start>–L<end>` label. */
  ranges?: Record<string, { start: number; end: number }>;
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onReanchor: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
  onEditDraft: (id: string, seq: number, body: string) => void | Promise<void>;
  onDeleteDraft: (id: string, seq: number) => void | Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const lineRanges = matches.flatMap((m) => {
      const r = ranges?.[m.review.id];
      return r ? [{ side: m.review.anchor.side, start: r.start, end: r.end }] : [];
    });
    if (lineRanges.length === 0) return;
    return observeReviewRange(root, lineRanges);
  }, [matches, ranges]);

  return (
    <div ref={rootRef} className="flex flex-col pl-8">
      {matches.map((match) => (
        <ReviewThreadCard
          key={match.review.id}
          match={match}
          range={ranges?.[match.review.id]}
          onReply={onReply}
          onResolve={onResolve}
          onReanchor={onReanchor}
          onResend={onResend}
          onEditDraft={onEditDraft}
          onDeleteDraft={onDeleteDraft}
        />
      ))}
    </div>
  );
}
