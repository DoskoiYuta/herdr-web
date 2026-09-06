import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Decision, DecisionEvent } from "@contract/decision";
import { decisionApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** `すべて` を含む一覧フィルタの値 (plan F13-8)。`"all"` は `status` を渡さない。 */
type StatusFilter = "open" | "answered" | "dismissed" | "cancelled" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  open: "未回答",
  answered: "回答済み",
  dismissed: "却下",
  cancelled: "取り下げ",
  all: "すべて",
};

export type DecisionListViewProps = {
  worktreeRoot: string;
  onSelect: (id: string) => void;
  onClose?: () => void;
  subscribeDecisionEvents?: (cb: (event: DecisionEvent) => void) => () => void;
};

function resultLabel(decision: Decision): string | null {
  if (decision.status === "open") return null;
  if (decision.status !== "answered" || !decision.answer) return null;
  const parts = Object.entries(decision.answer.answers).map(([, a]) => {
    const selected = a.selected.length > 0 ? a.selected.join(",") : null;
    return selected ?? a.other ?? "";
  });
  return parts.filter(Boolean).join(", ") || null;
}

/** worktree の判断依頼一覧 (plan F13-8)。既定は open のみ。非 open の行には
 * 結果（answered の選択内容）と配達状態を出す。 */
export function DecisionListView({
  worktreeRoot,
  onSelect,
  onClose,
  subscribeDecisionEvents,
}: DecisionListViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const queryClient = useQueryClient();
  const queryKey = ["decision-list", worktreeRoot, statusFilter];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      decisionApi.list({
        worktreeRoot,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
  });
  const decisions = query.data ?? [];

  useEffect(() => {
    if (!subscribeDecisionEvents) return;
    return subscribeDecisionEvents(() => {
      void queryClient.invalidateQueries({ queryKey: ["decision-list", worktreeRoot] });
    });
  }, [subscribeDecisionEvents, queryClient, worktreeRoot]);

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="truncate text-sm font-semibold">判断依頼</h2>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger size="sm" className="w-28" aria-label="状態で絞り込み">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_FILTER_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onClose && (
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              閉じる
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {decisions.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">依頼はありません</p>
        )}
        <ul className="flex flex-col gap-1">
          {decisions.map((decision, i) => {
            const result = resultLabel(decision);
            return (
              <li key={decision.id}>
                <button
                  type="button"
                  onClick={() => onSelect(decision.id)}
                  data-testid={`decision-row-${decision.id}`}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate font-medium">
                    {i < 9 && <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>}
                    {decision.spec.title ?? "(no title)"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {decision.status} · {decision.agent ?? "?"}
                    {result && ` · 結果: ${result}`}
                    {decision.status !== "open" &&
                      ` · 配達: ${decision.delivery?.state ?? "pending"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
