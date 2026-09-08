// TanStack Query wrapper around gitApi.status(). Row decoration only — see
// useLs.ts for the plain filesystem listing this status is overlaid on.

import { useQuery } from "@tanstack/react-query";
import { gitApi } from "@/lib/api";

export function statusQueryKey(repo: string, repoChangedTick: number) {
  return ["status", repo, repoChangedTick] as const;
}

export function useStatus(repo: string, repoChangedTick: number, pollMs?: number, enabled = true) {
  return useQuery({
    queryKey: statusQueryKey(repo, repoChangedTick),
    queryFn: () => gitApi.status(repo),
    staleTime: Infinity,
    refetchInterval: pollMs,
    retry: false,
    enabled,
  });
}
