// docs/ui-redesign.md §6.2: 要対応/進行中/完了/無効の 4 語。呼び出し側は
// done/void のときだけ描く運用だが、部品としては 4 種すべて描ける。
import type { Turn } from "@/lib/statusVocab";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TURN_LABEL: Record<Turn, string> = {
  action: "要対応",
  progress: "進行中",
  done: "完了",
  void: "無効",
};

const TURN_CLASS: Record<Turn, string> = {
  action: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  progress: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  void: "bg-muted text-muted-foreground",
};

const TURN_DOT_CLASS: Record<Turn, string> = {
  action: "bg-amber-500 dark:bg-amber-400",
  progress: "bg-sky-500 dark:bg-sky-400",
  done: "bg-emerald-500 dark:bg-emerald-400",
  void: "bg-muted-foreground",
};

export function StatusChip({ turn, label }: { turn: Turn; label?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid="status-chip"
      data-turn={turn}
      className={cn("border-transparent", TURN_CLASS[turn])}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TURN_DOT_CLASS[turn])} />
      {label ?? TURN_LABEL[turn]}
    </Badge>
  );
}
