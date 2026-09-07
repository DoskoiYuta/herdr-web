// Inline ask thread card (F10), rendered under a ForFileMatch's `endLine`.
// Polls GET /api/ask/:id for `sessionStatus` (not stored — herdr is asked
// live) every 5s while the thread is still open/replied and the session
// hasn't gone away; a resolved/outdated thread or a gone session stops
// polling since neither can change further without a user action here.
import { useQuery } from "@tanstack/react-query";
import type { AskSessionStatus } from "@contract/ask";
import type { ForFileMatch } from "@/lib/api";
import { askApi } from "@/lib/api";
import { ThreadCard } from "@/components/thread/ThreadCard";
import { deliveryOf, turnOf } from "@/lib/statusVocab";

const POLL_MS = 5000;

const SESSION_STATUS_LABEL: Record<AskSessionStatus, string> = {
  idle: "待機中",
  working: "作業中",
  blocked: "ブロック中",
  done: "完了",
  unknown: "不明",
  gone: "セッション消失",
};

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
  const lastEntry = current.thread[current.thread.length - 1];

  const location =
    range && range.end > range.start
      ? `${current.path}:L${range.start}–L${range.end}`
      : `${current.path}:L${range?.start ?? current.anchor.lineHint}`;

  return (
    <ThreadCard
      kind="ask"
      location={location}
      turn={turnOf("ask", current.status)}
      delivery={
        current.lastPrompt
          ? { ...deliveryOf("ask", current.lastPrompt), onResend: () => onResend(ask.id) }
          : undefined
      }
      unread={lastEntry?.author === "agent"}
      messages={current.thread.map((entry) => ({
        author: entry.author,
        at: entry.at,
        body: entry.body,
      }))}
      reply={{ placeholder: "返信", onSubmit: (body) => onReply(ask.id, body) }}
      actions={[
        ...(current.session ? [{ label: "herdr で開く", onClick: () => onFocus(ask.id) }] : []),
        ...(current.status !== "resolved"
          ? [{ label: "解決", onClick: () => onResolve(ask.id) }]
          : []),
      ]}
      extra={
        current.session ? (
          <span className="text-[10px] text-muted-foreground" data-testid="ask-session-status">
            {current.session.kind === "herdr" ? (current.session.agent ?? "不明") : "不明"} ·{" "}
            {SESSION_STATUS_LABEL[current.sessionStatus]}
          </span>
        ) : undefined
      }
    />
  );
}

export default AskThread;
