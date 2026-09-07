// docs/ui-redesign.md §6.3: 配達状態の 6 語。canResend のときだけ chip 内に
// 「再送」を出す（Review notify / Decision delivery / Ask lastPrompt 共通）。
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

const STATE_CLASS: Record<DeliveryState, string> = {
  unsent: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
  sent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  blocked: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  no_target: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  unknown: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function DeliveryChip({
  delivery,
  onResend,
}: {
  delivery: DeliveryResult;
  onResend?: () => void | Promise<void>;
}) {
  return (
    <Badge
      variant="outline"
      data-testid="delivery-chip"
      data-delivery-state={delivery.state}
      className={cn("gap-1 border-transparent", STATE_CLASS[delivery.state])}
    >
      {STATE_LABEL[delivery.state]}
      {delivery.canResend && (
        <button
          type="button"
          className="underline underline-offset-2 hover:opacity-80"
          onClick={() => void onResend?.()}
        >
          再送
        </button>
      )}
    </Badge>
  );
}
