import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DecisionEvent } from "@contract/decision";
import { decisionApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type DecisionListViewProps = {
  worktreeRoot: string;
  onSelect: (id: string) => void;
  onClose?: () => void;
  subscribeDecisionEvents?: (cb: (event: DecisionEvent) => void) => () => void;
};

/** worktree の判断依頼一覧 (plan F13-8)。既定は open のみ、履歴フィルタで全件。 */
export function DecisionListView({
  worktreeRoot,
  onSelect,
  onClose,
  subscribeDecisionEvents,
}: DecisionListViewProps) {
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["decision-list", worktreeRoot, showHistory];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      decisionApi.list({
        worktreeRoot,
        status: showHistory ? undefined : "open",
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
          <ToggleGroup
            type="single"
            value={showHistory ? "history" : "open"}
            onValueChange={(v) => v && setShowHistory(v === "history")}
            size="sm"
          >
            <ToggleGroupItem value="open">未回答</ToggleGroupItem>
            <ToggleGroupItem value="history">履歴</ToggleGroupItem>
          </ToggleGroup>
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
          {decisions.map((decision, i) => (
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
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
