// TanStack Query wrapper around reviewApi.counts(), for the git-graph badges
// and the send button's count. Mirrors useGraph.ts's convention: never
// auto-refetches on its own (staleTime: Infinity), driven instead by an
// explicit `tick` bump (a review WS event, or repoChangedTick — see
// ToolPane.tsx).
import { useQuery } from "@tanstack/react-query";
import { reviewApi } from "@/lib/api";

export function reviewCountsQueryKey(
  repo: string,
  worktree: string,
  tick: number,
): readonly unknown[] {
  return ["review-counts", repo, worktree, tick] as const;
}

/** Pass `params: null` to skip fetching (e.g. repo not resolved yet). */
export function useReviewCounts(params: { repo: string; worktree: string } | null, tick = 0) {
  return useQuery({
    queryKey: reviewCountsQueryKey(params?.repo ?? "", params?.worktree ?? "", tick),
    queryFn: () => reviewApi.counts(params as { repo: string; worktree: string }),
    enabled: params !== null,
    staleTime: Infinity,
    retry: false,
  });
}
