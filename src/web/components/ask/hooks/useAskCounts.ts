// TanStack Query wrapper around askApi.counts(), for the Files tab's
// notification badge (ui-redesign.md §5.4). Mirrors useReviewCounts.ts:
// never auto-refetches on its own (staleTime: Infinity), driven instead by
// an explicit `tick` bump (an ask WS event, or repoChangedTick).
import { useQuery } from "@tanstack/react-query";
import { askApi } from "@/lib/api";

export function askCountsQueryKey(
  repo: string,
  worktree: string,
  tick: number,
): readonly unknown[] {
  return ["ask-counts", repo, worktree, tick] as const;
}

/** Pass `params: null` to skip fetching (e.g. repo not resolved yet). */
export function useAskCounts(params: { repo: string; worktree: string } | null, tick = 0) {
  return useQuery({
    queryKey: askCountsQueryKey(params?.repo ?? "", params?.worktree ?? "", tick),
    queryFn: () => askApi.counts(params as { repo: string; worktree: string }),
    enabled: params !== null,
    staleTime: Infinity,
    retry: false,
  });
}
