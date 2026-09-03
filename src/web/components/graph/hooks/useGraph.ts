// TanStack Query wrapper around gitApi.graph(). Never auto-refetches on its
// own (staleTime: Infinity) — invalidation is driven by `repoChangedTick`
// changing (see GraphPanel.tsx) or an explicit refetch.

import { useQuery } from "@tanstack/react-query";
import { gitApi } from "@/lib/api";

export function graphQueryKey(
  repo: string,
  all: boolean,
  max: number,
  repoChangedTick: number,
): readonly unknown[] {
  return ["graph", repo, all, max, repoChangedTick] as const;
}

export function useGraph(repo: string, all: boolean, max: number, repoChangedTick = 0) {
  return useQuery({
    queryKey: graphQueryKey(repo, all, max, repoChangedTick),
    queryFn: () => gitApi.graph({ repo, all, max }),
    staleTime: Infinity,
    retry: false,
  });
}
