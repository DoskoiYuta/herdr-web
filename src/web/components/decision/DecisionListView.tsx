import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Decision, DecisionSpec, DecisionStatus } from "@contract/decision";
import type { Repo } from "@contract/events";
import { decisionApi } from "@/lib/api";
import { useDecisionEvents, useHerdrState } from "@/lib/HerdrStoreContext";
import { relativeTime, useNow } from "@/lib/relativeTime";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeliveryChip } from "@/components/ui/status/DeliveryChip";
import { StatusChip } from "@/components/ui/status/StatusChip";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { deliveryOf, turnOf } from "@/lib/statusVocab";
import { findPane, isTypingTarget } from "./DecisionView";
import { agentLabel, DECISION_STATUS_LABEL } from "./decisionLabels";
import { useDecisionCounts } from "./hooks/useDecisionCounts";

type StatusTab = "open" | "answered" | "all";

/** Radix `Select` doesn't allow `value=""` — sentinel for「すべての worktree」. */
const ALL_WORKTREES = "__all__";

const ITEM_KIND_LABEL: Record<DecisionSpec["items"][number]["kind"], string> = {
  single: "単一選択",
  multi: "複数選択",
  text: "自由記述",
  confirm: "確認",
};

function questionSummary(spec: DecisionSpec): string {
  const kinds = new Set(spec.items.map((i) => i.kind));
  const kindLabel = kinds.size === 1 ? ITEM_KIND_LABEL[[...kinds][0]!] : "複数種";
  return `${spec.items.length}問 · ${kindLabel}`;
}

function resultLabel(decision: Decision): string | null {
  if (decision.status !== "answered" || !decision.answer) return null;
  const parts = Object.entries(decision.answer.answers).map(([, a]) => {
    const selected = a.selected.length > 0 ? a.selected.join(",") : null;
    return selected ?? a.other ?? "";
  });
  return parts.filter(Boolean).join(", ") || null;
}

/** 非 open な行の補足。answered 以外は resultLabel が常に null を返すため、
 * ステータスごとに文言を分ける（レビュー指摘: 全部「回答あり」に落ちていた）。 */
function secondarySummary(decision: Decision): string {
  switch (decision.status) {
    case "open":
      return questionSummary(decision.spec);
    case "answered":
      return resultLabel(decision) ?? "回答あり";
    case "dismissed":
      return "却下";
    case "cancelled":
      return "エージェントが取り下げ";
  }
}

function worktreeBasename(root: string | null): string | null {
  if (!root) return null;
  const trimmed = root.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}


function DecisionRow({
  decision,
  index,
  nowMs,
  repos,
  onSelect,
  onResend,
}: {
  decision: Decision;
  index?: number;
  nowMs: number;
  repos: Repo[];
  onSelect: (id: string) => void;
  onResend: (id: string) => Promise<void>;
}) {
  const delivery = deliveryOf("decision", decision.delivery);
  const showDelivery = decision.delivery !== null && delivery.state !== "sent";
  const [busy, setBusy] = useState(false);
  const worktree = worktreeBasename(decision.worktreeRoot);
  const pane = findPane(repos, decision.paneId, decision.agent);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-testid={`decision-row-${decision.id}`}
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("button")) return;
          onSelect(decision.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(decision.id);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm hover:bg-muted"
      >
        {index !== undefined && index < 9 && (
          <Badge variant="outline" className="shrink-0">
            {index + 1}
          </Badge>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {decision.spec.title ?? decision.spec.items[0]?.header ?? "(no title)"}
          </div>
          <div className="truncate text-xs text-muted-foreground">{secondarySummary(decision)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[worktree, agentLabel(decision.agent, pane), relativeTime(decision.createdAt, nowMs)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <StatusChip
          turn={turnOf("decision", decision.status)}
          label={DECISION_STATUS_LABEL[decision.status]}
        />
        {showDelivery && (
          <DeliveryChip
            delivery={delivery}
            busy={busy}
            onResend={async () => {
              setBusy(true);
              try {
                await onResend(decision.id);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </div>
    </li>
  );
}

export type DecisionListViewProps = { onSelect: (id: string) => void };

/** 全 worktree 横断の判断依頼一覧 (docs/ui-redesign.md §5.4)。未回答をカードで
 * 上に、非 open な行は「回答済み」「すべて」タブでのみ「最近の履歴」に出す。 */
export function DecisionListView({ onSelect }: DecisionListViewProps) {
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [worktreeFilter, setWorktreeFilter] = useState<string>(ALL_WORKTREES);
  const queryClient = useQueryClient();
  const state = useHerdrState();
  const nowMs = useNow();

  const worktreeOptions = useMemo(() => {
    const roots = new Set<string>();
    for (const repo of state.repos) for (const wt of repo.worktrees) roots.add(wt.root);
    return [...roots].sort();
  }, [state.repos]);

  const statusParam: DecisionStatus | undefined =
    statusTab === "all" ? undefined : (statusTab as DecisionStatus);
  const worktreeRoot = worktreeFilter === ALL_WORKTREES ? undefined : worktreeFilter;

  const query = useQuery({
    queryKey: ["decision-list", statusParam ?? "all", worktreeRoot ?? "all"],
    queryFn: () => decisionApi.list({ status: statusParam, worktreeRoot }),
  });
  const decisions = query.data ?? [];
  const unanswered = decisions.filter((d) => d.status === "open");
  const history = decisions.filter((d) => d.status !== "open");
  const showHistory = statusTab !== "open";

  // レビュー指摘: worktree を絞り込んだら「未回答 N」もその worktree の件数に
  // 従うべきで、全 worktree 横断の useDecisionCounts に固定したままではいけない
  // （サーバーに worktree 別カウント API は無いので、絞り込み中はここで
  // status=open のリストを引いて件数を数える）。この queryKey は statusTab==
  // "open" のときのメインクエリと一致するため、React Query が 1 回にまとめる。
  const countsQuery = useDecisionCounts();
  const openCountForWorktreeQuery = useQuery({
    queryKey: ["decision-list", "open", worktreeRoot ?? "all"],
    queryFn: () => decisionApi.list({ status: "open", worktreeRoot }),
    enabled: worktreeRoot !== undefined,
  });
  const openTotal =
    worktreeRoot !== undefined
      ? (openCountForWorktreeQuery.data?.length ?? 0)
      : (countsQuery.data?.total ?? 0);

  useDecisionEvents(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["decision-list"] });
    }, [queryClient]),
  );

  useEffect(() => {
    function handleDigit(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const digit = Number(e.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const target = unanswered[digit - 1];
      if (target) onSelect(target.id);
    }
    window.addEventListener("keydown", handleDigit);
    return () => window.removeEventListener("keydown", handleDigit);
  }, [unanswered, onSelect]);

  const toast = useToast();
  const resend = useCallback(
    async (id: string) => {
      try {
        await decisionApi.resend(id);
        await queryClient.invalidateQueries({ queryKey: ["decision-list"] });
      } catch {
        // サーバーの再送処理には状態ゲートが無い（DeliveryChip busy コメント
        // 参照）— 失敗を握りつぶすと、届いたと誤解したまま待ち続ける。
        toast({ kind: "error", message: "再送に失敗しました" });
      }
    },
    [queryClient, toast],
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
          <TabsList>
            <TabsTrigger value="open" data-testid="decision-status-tab-open">
              未回答 {openTotal}
            </TabsTrigger>
            <TabsTrigger value="answered" data-testid="decision-status-tab-answered">
              回答済み
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="decision-status-tab-all">
              すべて
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={worktreeFilter} onValueChange={setWorktreeFilter}>
          <SelectTrigger size="sm" className="w-48" aria-label="worktree で絞り込み">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WORKTREES}>すべての worktree</SelectItem>
            {worktreeOptions.map((root) => (
              <SelectItem key={root} value={root}>
                {worktreeBasename(root) ?? root}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {unanswered.length === 0 && (!showHistory || history.length === 0) && (
          <p className="p-2 text-xs text-muted-foreground">依頼はありません</p>
        )}
        {unanswered.length > 0 && (
          <ul data-testid="decision-unanswered" className="flex flex-col gap-1.5">
            {unanswered.map((decision, i) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                index={i}
                nowMs={nowMs}
                repos={state.repos}
                onSelect={onSelect}
                onResend={resend}
              />
            ))}
          </ul>
        )}
        {showHistory && history.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <h3 className="px-2 text-xs font-semibold text-muted-foreground">最近の履歴</h3>
            <ul data-testid="decision-history" className="flex flex-col gap-1.5">
              {history.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  nowMs={nowMs}
                  repos={state.repos}
                  onSelect={onSelect}
                  onResend={resend}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
