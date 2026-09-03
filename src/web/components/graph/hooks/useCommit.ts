// TanStack Query wrapper around gitApi.commit(). Disabled entirely for the
// UNCOMMITTED pseudo-commit and while nothing is selected — the server has
// nothing to say about either.

import { useQuery } from "@tanstack/react-query";
import { gitApi } from "@/lib/api";

export const UNCOMMITTED_HASH = "UNCOMMITTED";

export function commitQueryKey(repo: string, hash: string): readonly unknown[] {
  return ["commit", repo, hash] as const;
}

export function useCommit(repo: string, hash: string | null) {
  const enabled = hash !== null && hash !== UNCOMMITTED_HASH;
  return useQuery({
    queryKey: commitQueryKey(repo, hash ?? ""),
    queryFn: () => gitApi.commit({ repo, hash: hash as string }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}
