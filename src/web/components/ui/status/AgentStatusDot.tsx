// エージェント状態（アイコン＋色）。サイドバー、Tool header、送信先カード、
// Inbox 行で共通して使う（docs/ui-redesign.md §6.4）。色は design.pen P0:
// working #3B82F6 / blocked #F59E0B / done #22C55E / idle #71717A、
// unknown だけは固定色を持たず border 色（テーマ追従）。
import { CircleCheck, CircleDashed, CircleHelp, Loader2, OctagonAlert } from "lucide-react";
import type { AgentStatus } from "@contract/herdr";
import { cn } from "@/lib/utils";

export type StatusMeta = {
  icon: typeof CircleDashed;
  label: string;
  className: string;
  spin?: boolean;
};

export const STATUS_META: Record<AgentStatus, StatusMeta> = {
  idle: { icon: CircleDashed, label: "idle", className: "text-[#71717A]" },
  working: { icon: Loader2, label: "working", className: "text-[#3B82F6]", spin: true },
  blocked: { icon: OctagonAlert, label: "blocked", className: "text-[#F59E0B]" },
  done: { icon: CircleCheck, label: "done", className: "text-[#22C55E]" },
  unknown: { icon: CircleHelp, label: "unknown", className: "text-border" },
};

export function AgentStatusDot({
  status,
  label,
  className,
}: {
  status: AgentStatus;
  label?: string;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon
        className={cn("size-3.5 shrink-0", meta.className, meta.spin && "animate-spin")}
        aria-label={`状態: ${meta.label}`}
      />
      {label && <span className="truncate">{label}</span>}
    </span>
  );
}
