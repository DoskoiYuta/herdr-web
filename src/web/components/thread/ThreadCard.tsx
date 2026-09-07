// Review / Ask 共用のスレッド部品（docs/ui-redesign.md §6.1）。種別非依存の
// props を受け、再取得・ポーリング・API 呼び出しは呼び出し側（ReviewAnnotation /
// AskThread）に残す。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DeliveryChip } from "@/components/ui/status/DeliveryChip";
import { KindIcon } from "@/components/ui/status/KindIcon";
import { StatusChip } from "@/components/ui/status/StatusChip";
import type { DeliveryResult, Turn } from "@/lib/statusVocab";
import { cn } from "@/lib/utils";

/** 明滅の対象になっている間表示し続ける最短時間。カードが viewport に入って
 * この時間が経つか、内部の要素にフォーカス/クリックが入ったら止める。 */
const VISIBLE_STOP_MS = 2000;

export type ThreadCardMessage = {
  author: "user" | "agent";
  agentLabel?: string;
  at: string;
  body: string;
  draft?: boolean;
  onEdit?: (body: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
};

export type ThreadCardAction = {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "outline" | "ghost";
};

export type ThreadCardProps = {
  kind: "review" | "ask";
  location: string;
  turn: Turn;
  delivery?: DeliveryResult & { onResend?: () => void | Promise<void>; busy?: boolean };
  unread: boolean;
  messages: ThreadCardMessage[];
  reply: {
    placeholder: string;
    onSubmit: (body: string) => void | Promise<void>;
    disabled?: boolean;
  };
  actions: ThreadCardAction[];
  positionEstimated?: boolean;
  extra?: ReactNode;
};

function DraftMessageRow({ message }: { message: ThreadCardMessage }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(message.body);
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
                await message.onEdit?.(body.trim());
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
        <span className="font-medium">{message.author === "user" ? "user" : "agent"}</span>
        <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          下書き
        </span>
        <span className="ml-1 whitespace-pre-wrap">{message.body}</span>
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
              await message.onDelete?.();
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

export function ThreadCard({
  kind,
  location,
  turn,
  delivery,
  unread,
  messages,
  reply,
  actions,
  positionEstimated = false,
  extra,
}: ThreadCardProps) {
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // "止めた" は特定のメッセージに紐づける（bool の一度きりのフラグにしない）
  // — 同じカード（同じ key）のまま unread が false→true に変わる典型ケース
  // （Diff を開いたままエージェントが返信する）で、新着メッセージごとに
  // 明滅が再開できるようにする。
  const lastMessageAt = messages.length > 0 ? (messages[messages.length - 1]?.at ?? null) : null;
  const shouldBlink = unread && turn === "action";
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  const blinking = shouldBlink && stoppedFor !== lastMessageAt;

  const stopBlinking = useCallback(() => setStoppedFor(lastMessageAt), [lastMessageAt]);

  useEffect(() => {
    if (!blinking) return;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      const t = setTimeout(stopBlinking, VISIBLE_STOP_MS);
      return () => clearTimeout(t);
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && timer === null) {
          timer = setTimeout(stopBlinking, VISIBLE_STOP_MS);
        }
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [blinking, stopBlinking]);

  const submitReply = async () => {
    if (!replyBody.trim() || busy || reply.disabled) return;
    setBusy(true);
    try {
      await reply.onSubmit(replyBody.trim());
      setReplyBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={cardRef}
      data-testid="thread-card"
      data-blinking={blinking ? "true" : "false"}
      onFocusCapture={stopBlinking}
      onClickCapture={stopBlinking}
      className={cn(
        "my-1 flex flex-col gap-1.5 rounded-md border bg-popover p-2 shadow-sm",
        blinking ? "thread-card-blink border-accent" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindIcon kind={kind} />
        <span className="font-mono text-[10px] text-muted-foreground">{location}</span>
        {(turn === "done" || turn === "void") && <StatusChip turn={turn} />}
        {delivery && (
          <DeliveryChip delivery={delivery} onResend={delivery.onResend} busy={delivery.busy} />
        )}
        {positionEstimated && <span className="text-[10px] text-muted-foreground">位置は推定</span>}
        {extra}
      </div>

      <div className="flex flex-col gap-1">
        {messages.map((message, i) =>
          message.draft ? (
            <DraftMessageRow key={i} message={message} />
          ) : (
            <div key={i} className="text-xs">
              <span className="font-medium">
                {message.author === "user" ? "user" : (message.agentLabel ?? "agent")}
              </span>
              <span className="ml-1 whitespace-pre-wrap">{message.body}</span>
            </div>
          ),
        )}
      </div>

      <div className="flex items-center gap-1">
        <Textarea
          placeholder={reply.placeholder}
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setReplyBody("");
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitReply();
          }}
          className="min-h-8 text-xs"
        />
        <Button
          type="button"
          size="xs"
          onClick={() => void submitReply()}
          disabled={busy || reply.disabled || !replyBody.trim()}
        >
          送信
        </Button>
      </div>

      {actions.length > 0 && (
        <div className="flex justify-end gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              size="xs"
              variant={action.variant ?? "outline"}
              onClick={() => void action.onClick()}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ThreadCard;
