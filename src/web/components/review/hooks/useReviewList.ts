// TanStack Query wrapper around reviewApi.list(). Mirrors usePatch.ts /
// useGraph.ts's convention: never auto-refetches on its own (staleTime:
// Infinity), driven instead by an explicit `tick` bump (here: a
// review/review-notify WS event via subscribeReviewEvents — see
// ReviewPanel.tsx and ToolPane.tsx) so the fetch itself stays inside
// react-query's own effects rather than a raw useEffect+setState in ours.
import { useQuery } from "@tanstack/react-query";
import type { ListReviewQuery } from "@contract/review";
import { reviewApi } from "@/lib/api";

export function reviewListQueryKey(query: ListReviewQuery, tick: number): readonly unknown[] {
  return ["review-list", query, tick] as const;
}

/** Pass `query: null` to skip fetching (e.g. repo not resolved yet). */
export function useReviewList(query: ListReviewQuery | null, tick = 0) {
  return useQuery({
    queryKey: reviewListQueryKey(query ?? {}, tick),
    queryFn: () => reviewApi.list(query as ListReviewQuery),
    enabled: query !== null,
    staleTime: Infinity,
    retry: false,
  });
}
