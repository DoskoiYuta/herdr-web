// Inline ask thread card (F10), rendered under a ForFileMatch's `endLine`.
// Polls GET /api/ask/:id for `sessionStatus` (not stored — herdr is asked
// live) every 5s while the thread is still open/replied and the session
// hasn't gone away; a resolved/outdated thread or a gone session stops
// polling since neither can change further without a user action here.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AskStatus, AskSessionStatus } from "@contract/ask";
import type { ForFileMatch } from "@/lib/api";
import { askApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const POLL_MS = 5000;

const STATUS_LABEL: Record<AskStatus, string> = {
  open: "open",
  replied: "replied",
  resolved: "resolved",
  outdated: "outdated",
};

const STATUS_CLASS: Record<AskStatus, string> = {
  open: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  replied: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  outdated: "bg-muted text-muted-foreground",
};

const SESSION_STATUS_LABEL: Record<AskSessionStatus, string> = {
  idle: "待機中",
  working: "作業中",
  blocked: "ブロック中",
  done: "完了",
  unknown: "不明",
  gone: "セッション消失",
};

function StatusBadge({ status }: { status: AskStatus }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[status]}`}
      data-testid="ask-status-badge"
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface AskThreadProps {
  match: ForFileMatch;
  /** Real (1-based) line range the anchor's range spans, for the
   * `L<start>–L<end>` label — omitted (single-line) when start === end. */
  range?: { start: number; end: number };
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
  onFocus: (id: string) => void | Promise<void>;
}

export function AskThread({ match, range, onReply, onResolve, onResend, onFocus }: AskThreadProps) {
  const { ask } = match;
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ["ask", ask.id],
    queryFn: () => askApi.get(ask.id),
    initialData:
      ask.status === "resolved" || ask.status === "outdated"
        ? undefined
        : { ...ask, sessionStatus: "unknown" as const },
    refetchInterval: (query) => {
      if (ask.status === "resolved" || ask.status === "outdated") return false;
      const data = query.state.data;
      if (!data || data.sessionStatus === "gone") return false;
      return POLL_MS;
    },
  });

  // `ask` (the for-file prop) is the source of truth for status/thread/lastPrompt —
  // it's refetched on every ask event, while this query only exists to poll
  // `sessionStatus` (herdr is asked live, not stored) and can go stale once it
  // stops refetching. Only `sessionStatus` comes from the query.
  const current = { ...ask, sessionStatus: sessionQuery.data?.sessionStatus ?? "unknown" };
  const unsent =
    current.lastPrompt?.state === "agent_blocked" || current.lastPrompt?.state === "gone";
  const failed = current.lastPrompt?.state === "failed";

  const submitReply = async () => {
    if (!replyBody.trim() || busy) return;
    setBusy(true);
    try {
      await onReply(ask.id, replyBody.trim());
      setReplyBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="my-1 flex flex-col gap-1.5 rounded-md border border-border bg-popover p-2 shadow-sm"
      data-testid="ask-thread"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={current.status} />
        {range && range.end > range.start && (
          <span className="text-[10px] text-muted-foreground">
            L{range.start}–L{range.end}
          </span>
        )}
        {current.session && (
          <span className="text-[10px] text-muted-foreground" data-testid="ask-session-status">
            {SESSION_STATUS_LABEL[current.sessionStatus]}
          </span>
        )}
        {(unsent || failed) && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            未送信
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => void onResend(ask.id)}
            >
              再送
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {current.thread.map((entry) => (
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
        {current.session && (
          <Button type="button" size="xs" variant="outline" onClick={() => void onFocus(ask.id)}>
            herdr で開く
          </Button>
        )}
        {current.status !== "resolved" && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            title="このセッションを閉じます"
            onClick={() => void onResolve(ask.id)}
          >
            解決
          </Button>
        )}
      </div>
    </div>
  );
}

export default AskThread;
