// TanStack Query wrapper around gitApi.patch (GET /api/git/patch). Trimmed
// port of terminal-diff's src/client/hooks/usePatch.ts: dropped the
// SSE-driven "instance" binding and the 503 notReady path (herdr-web has no
// long-running tdiff server process to be "not ready" against — repo
// resolution failures surface as ordinary fetch errors instead).
//
// Unlike tdiff's version (manual refetch only, driven by the `r` key / the
// update banner's button), this hook also refetches automatically whenever
// `repoChangedTick` changes — that's DiffPanel's signal that the poller
// noticed the repo's git state moved. The fetch always lands in the query
// cache; DiffPanel decides whether to auto-apply the new content or hold it
// behind an "update available" banner (see state.ts's banner reducer).

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { gitApi } from "@/lib/api";

export function patchQueryKey(repo: string, from: string | undefined, to: string | undefined) {
  return ["patch", repo, from, to] as const;
}

export interface UsePatchParams {
  repo: string;
  from?: string;
  to?: string;
  /** Bumped by the caller whenever the repo's git state is known to have
   * changed (e.g. from a `repo-changed` WS event) — triggers a refetch. */
  repoChangedTick: number;
}

export function usePatch({ repo, from, to, repoChangedTick }: UsePatchParams) {
  const query = useQuery({
    queryKey: patchQueryKey(repo, from, to),
    queryFn: () => gitApi.patch({ repo, from, to }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Skip the tick that merely mounted the query (initial fetch already
  // covers it) — only react to it actually *changing* thereafter.
  const seenTickRef = useRef(repoChangedTick);
  useEffect(() => {
    if (seenTickRef.current === repoChangedTick) return;
    seenTickRef.current = repoChangedTick;
    void query.refetch();
    // query.refetch is stable enough for this purpose (react-query keeps the
    // same reference across renders as long as the query key doesn't
    // change); depending on it directly would refetch on every key change,
    // which the queryFn above already handles via TanStack Query itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoChangedTick]);

  return query;
}
