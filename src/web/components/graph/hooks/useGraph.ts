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

/**
 * `pollMs`: poll interval in ms, in addition to the `repoChangedTick`-driven
 * refetch. `repoChangedTick` is only emitted by the server for the
 * *focused* worktree (see poller.ts) — a sub-repo/submodule selected in the
 * tool pane never gets its own tick, so ToolPane passes a short `pollMs` in
 * that case to keep the graph reasonably fresh. Omit for the normal
 * tick-driven path.
 */
export function useGraph(
  repo: string,
  all: boolean,
  max: number,
  repoChangedTick = 0,
  pollMs?: number,
) {
  return useQuery({
    queryKey: graphQueryKey(repo, all, max, repoChangedTick),
    queryFn: () => gitApi.graph({ repo, all, max }),
    staleTime: Infinity,
    refetchInterval: pollMs,
    retry: false,
  });
}
