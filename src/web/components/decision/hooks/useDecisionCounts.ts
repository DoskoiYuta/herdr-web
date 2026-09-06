import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { decisionApi } from "@/lib/api";
import type { DecisionEvent } from "@/lib/decisionEvent";

const DECISION_COUNTS_QUERY_KEY = ["decision-counts"];
const REFETCH_MS = 30_000;

/** サイドバー上部の合計バッジ、worktree ごとの行の件数 (plan F13-8)。 */
export function useDecisionCounts(
  subscribeDecisionEvents?: (cb: (event: DecisionEvent) => void) => () => void,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DECISION_COUNTS_QUERY_KEY,
    queryFn: () => decisionApi.counts(),
    staleTime: Infinity,
    refetchInterval: REFETCH_MS,
  });

  useEffect(() => {
    if (!subscribeDecisionEvents) return;
    return subscribeDecisionEvents(() => {
      void queryClient.invalidateQueries({ queryKey: DECISION_COUNTS_QUERY_KEY });
    });
  }, [subscribeDecisionEvents, queryClient]);

  return query;
}
