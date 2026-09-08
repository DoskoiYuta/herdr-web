// TanStack Query wrapper around gitApi.patch (GET /api/git/patch). Trimmed
// port of terminal-diff's src/client/hooks/usePatch.ts: dropped the
// SSE-driven "instance" binding and the 503 notReady path (herdr-web has no
// long-running tdiff server process to be "not ready" against — repo
// resolution failures surface as ordinary fetch errors instead).
//
// `repoChangedTick` (DiffPanel's signal that the poller noticed the repo's
// git state moved) is part of the query key, matching the other tick-driven
// hooks (useStatus, useLs, useFile, useGraph, useReviewCounts) — this is
// what makes a fresh tick fetch even when the Diff tab was unmounted (Radix
// Tabs drops TabsContent for inactive tabs) while the tick advanced,
// instead of `staleTime: Infinity` serving whatever was last cached for the
// old key. `placeholderData: keepPreviousData` keeps the previous patch
// (and its `hash`) on screen while the new key's fetch is in flight, so
// DiffPanel's hash-based apply/banner logic sees no change until the new
// data actually lands.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { gitApi } from "@/lib/api";

export function patchQueryKey(
  repo: string,
  from: string | undefined,
  to: string | undefined,
  repoChangedTick: number,
) {
  return ["patch", repo, from, to, repoChangedTick] as const;
}

export interface UsePatchParams {
  repo: string;
  from?: string;
  to?: string;
  /** Bumped by the caller whenever the repo's git state is known to have
   * changed (e.g. from a `repo-changed` WS event) — part of the query key,
   * so a new tick fetches even for a repo/from/to combination already in
   * the cache under an older tick. */
  repoChangedTick: number;
  /**
   * Poll interval in ms, instead of relying solely on `repoChangedTick`.
   * `repoChangedTick` is only emitted by the server for the *focused*
   * worktree (see poller.ts) — a sub-repo/submodule selected in the tool
   * pane never gets its own tick, so ToolPane passes a short `pollMs` in
   * that case to keep the diff reasonably fresh. Omit for the normal
   * tick-driven path.
   */
  pollMs?: number;
}

export function usePatch({ repo, from, to, repoChangedTick, pollMs }: UsePatchParams) {
  return useQuery({
    queryKey: patchQueryKey(repo, from, to, repoChangedTick),
    queryFn: () => gitApi.patch({ repo, from, to }),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: pollMs,
    retry: false,
  });
}
