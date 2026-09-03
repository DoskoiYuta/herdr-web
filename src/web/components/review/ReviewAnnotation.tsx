// Renders the two DiffLineAnnotation kinds F3-6/F5-8 attach to a diff line:
// the "new comment" composer (opened by selecting a line) and the inline
// thread(s) of reviews already anchored there. Kept separate from
// DiffPanel.tsx so both are unit-testable without mounting @pierre/diffs.
import { useState } from "react";
import type { Review } from "@contract/review";
import type { ForDiffMatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
          コメント
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
  const state = review.notify?.state ?? "unknown";
  const label = NOTIFY_LABEL[state] ?? state;
  const [busy, setBusy] = useState(false);
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

export function ReviewThreadCard({
  match,
  onReply,
  onResolve,
  onReanchor,
  onResend,
}: {
  match: ForDiffMatch;
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onReanchor: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
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
        <NotifyIndicator review={review} onResend={onResend} />
        {dimmed && <span className="text-[10px] text-muted-foreground">位置は推定</span>}
      </div>

      <div className="flex flex-col gap-1">
        {review.thread.map((entry) => (
          <div key={entry.seq} className="text-xs">
            <span className="font-medium">{entry.author === "user" ? "user" : "agent"}</span>
            <span className="ml-1 whitespace-pre-wrap">{entry.body}</span>
          </div>
        ))}
      </div>

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
  onReply,
  onResolve,
  onReanchor,
  onResend,
}: {
  matches: ForDiffMatch[];
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onReanchor: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col">
      {matches.map((match) => (
        <ReviewThreadCard
          key={match.review.id}
          match={match}
          onReply={onReply}
          onResolve={onResolve}
          onReanchor={onReanchor}
          onResend={onResend}
        />
      ))}
    </div>
  );
}
