import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { decisionApi } from "@/lib/api";
import { useDecisionEvents } from "@/lib/HerdrStoreContext";

const DECISION_COUNTS_QUERY_KEY = ["decision-counts"];
const REFETCH_MS = 30_000;

/** Decisions タブのバッジ（`worktreeRoot` 指定でその worktree の open 件数）。
 * `worktreeRoot` が `null` の間はクエリを止める（フォーカス未解決）。 */
export function useDecisionCounts(worktreeRoot?: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...DECISION_COUNTS_QUERY_KEY, worktreeRoot ?? null],
    queryFn: () => decisionApi.counts(worktreeRoot ?? undefined),
    enabled: worktreeRoot !== null,
    staleTime: Infinity,
    refetchInterval: REFETCH_MS,
  });

  useDecisionEvents(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: DECISION_COUNTS_QUERY_KEY });
    }, [queryClient]),
  );

  return query;
}
