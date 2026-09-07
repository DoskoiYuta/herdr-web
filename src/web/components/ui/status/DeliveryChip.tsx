// docs/ui-redesign.md §6.3: 配達状態の 6 語。canResend のときだけ chip 内に
// 「再送」を出す（Review notify / Decision delivery / Ask lastPrompt 共通）。
// design.pen P0: StatusChip と違い pill ではなく角丸 6px の secondary 塗り。
import { Check, Clock, Flag, HelpCircle, Send, TriangleAlert } from "lucide-react";
import type { DeliveryResult, DeliveryState } from "@/lib/statusVocab";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<DeliveryState, string> = {
  unsent: "未送信",
  pending: "送信待ち",
  sent: "届いた",
  blocked: "入力待ちで未達",
  no_target: "宛先なし",
  unknown: "不明",
};

const STATE_ICON: Record<DeliveryState, typeof Send> = {
  unsent: Send,
  pending: Clock,
  sent: Check,
  blocked: TriangleAlert,
  no_target: Flag,
  unknown: HelpCircle,
};

const STATE_CLASS: Record<DeliveryState, string> = {
  unsent: "text-muted-foreground",
  pending: "text-muted-foreground",
  sent: "text-emerald-600 dark:text-emerald-400",
  blocked: "text-amber-600 dark:text-amber-400",
  no_target: "text-amber-600 dark:text-amber-400",
  unknown: "text-muted-foreground",
};

export function DeliveryChip({
  delivery,
  onResend,
  busy = false,
}: {
  delivery: DeliveryResult;
  onResend?: () => void | Promise<void>;
  /** 再送リクエストが飛んでいる間 true にする — サーバーの再送処理には
   * 状態ゲートが無いため、連打がそのまま複数回の通知になる。 */
  busy?: boolean;
}) {
  const Icon = STATE_ICON[delivery.state];
  return (
    <Badge
      variant="secondary"
      data-testid="delivery-chip"
      data-delivery-state={delivery.state}
      className={cn("gap-1 rounded-md border-transparent", STATE_CLASS[delivery.state])}
    >
      <Icon aria-hidden className="size-3" />
      {STATE_LABEL[delivery.state]}
      {delivery.canResend && (
        <button
          type="button"
          disabled={busy}
          className="underline underline-offset-2 hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void onResend?.()}
        >
          再送
        </button>
      )}
    </Badge>
  );
}
