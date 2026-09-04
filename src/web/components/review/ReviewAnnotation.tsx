// Renders the two DiffLineAnnotation kinds F3-6/F5-8 attach to a diff line:
// the "new comment" composer (opened by selecting a line) and the inline
// thread(s) of reviews already anchored there. Kept separate from
// DiffPanel.tsx so both are unit-testable without mounting @pierre/diffs.
import { useLayoutEffect, useRef, useState } from "react";
import type { Entry, Review } from "@contract/review";
import type { ForDiffMatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <div className="my-1 flex flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-sm">
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

const STATUS_LABEL: Record<Review["status"], string> = {
  open: "open",
  replied: "replied",
  resolved: "resolved",
  outdated: "outdated",
};

const STATUS_CLASS: Record<Review["status"], string> = {
  open: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  replied: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  outdated: "bg-muted text-muted-foreground",
};

const NOTIFY_LABEL: Record<string, string> = {
  pending: "未通知",
  sent: "通知済み",
  agent_blocked: "エージェント応答待ち",
  no_target: "通知先なし",
  unknown: "不明",
  none: "-",
};

function StatusBadge({ status }: { status: Review["status"] }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[status]}`}
      data-testid="review-status-badge"
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function NotifyIndicator({
  review,
  onResend,
}: {
  review: Review;
  onResend: (id: string) => void | Promise<void>;
}) {
  // A draft-only review has never been sent, so there's nothing to report a
  // notify state for — showing 未通知 here would read as "waiting to notify"
  // rather than "not sent yet", which is what 下書き already communicates.
  const hasSentEntry = review.thread.some((e) => !e.draft);
  const state = review.notify?.state ?? "unknown";
  const label = NOTIFY_LABEL[state] ?? state;
  const [busy, setBusy] = useState(false);
  if (!hasSentEntry) return null;
  if (state === "sent") {
    return <span className="text-[10px] text-muted-foreground">{label}</span>;
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {label}
      <button
        type="button"
        disabled={busy}
        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await onResend(review.id);
          } finally {
            setBusy(false);
          }
        }}
      >
        再送
      </button>
    </span>
  );
}

function DraftEntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  onEdit: (body: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(entry.body);
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <Textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-8 text-xs"
        />
        <div className="flex justify-end gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>
            キャンセル
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={busy || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onEdit(body.trim());
                setEditing(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <div>
        <span className="font-medium">{entry.author === "user" ? "user" : "agent"}</span>
        <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          下書き
        </span>
        <span className="ml-1 whitespace-pre-wrap">{entry.body}</span>
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setEditing(true)}
        >
          編集
        </button>
        <button
          type="button"
          disabled={busy}
          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            try {
              await onDelete();
            } finally {
              setBusy(false);
            }
          }}
        >
          削除
        </button>
      </div>
    </div>
  );
}

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
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const dimmed = confidence === "line";

  const submitReply = async () => {
    if (!replyBody.trim() || busy) return;
    setBusy(true);
    try {
      await onReply(review.id, replyBody.trim());
      setReplyBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`my-1 flex flex-col gap-1.5 rounded-md border border-border bg-popover p-2 shadow-sm ${
        dimmed ? "opacity-60" : ""
      }`}
      data-testid="review-thread"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={review.status} />
        {range && range.end > range.start && (
          <span className="text-[10px] text-muted-foreground">
            L{range.start}–L{range.end}
          </span>
        )}
        <NotifyIndicator review={review} onResend={onResend} />
        {dimmed && <span className="text-[10px] text-muted-foreground">位置は推定</span>}
      </div>

      <div className="flex flex-col gap-1">
        {review.thread.map((entry) =>
          entry.draft ? (
            <DraftEntryRow
              key={entry.seq}
              entry={entry}
              onEdit={(body) => onEditDraft(review.id, entry.seq, body)}
              onDelete={() => onDeleteDraft(review.id, entry.seq)}
            />
          ) : (
            <div key={entry.seq} className="text-xs">
              <span className="font-medium">{entry.author === "user" ? "user" : "agent"}</span>
              <span className="ml-1 whitespace-pre-wrap">{entry.body}</span>
            </div>
          ),
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Textarea
            placeholder="返信"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            className="min-h-8 text-xs"
          />
          <Button
            type="button"
            size="xs"
            onClick={() => void submitReply()}
            disabled={busy || !replyBody.trim()}
          >
            返信
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">送信ボタンでまとめて送信</p>
      </div>

      <div className="flex justify-end gap-2">
        {review.status === "outdated" && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void onReanchor(review.id)}
          >
            再アンカー
          </Button>
        )}
        {review.status !== "resolved" && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => void onResolve(review.id)}
          >
            解決
          </Button>
        )}
      </div>
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
    <div ref={rootRef} className="flex flex-col">
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
