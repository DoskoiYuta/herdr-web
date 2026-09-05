// TanStack Query wrapper around fsApi.file(). `placeholderData:
// keepPreviousData` keeps the last-rendered file on screen across a poll
// tick's refetch instead of the viewer flashing back to "loading" — the
// content is stale-labeled by TanStack Query's `isPlaceholderData`, but
// FilesPanel doesn't need that distinction (see plan.md F9).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fsApi } from "@/lib/api";

export function fileQueryKey(root: string, path: string | null, repoChangedTick: number) {
  return ["file", root, path, repoChangedTick] as const;
}

export function useFile(
  root: string,
  path: string | null,
  repoChangedTick: number,
  pollMs?: number,
  // False for a path routed to the image/PDF preview instead (FilesPanel) —
  // that viewer loads bytes itself via <img>/<iframe>, so fetching the text/
  // binary body here would be wasted work.
  enabled = true,
) {
  return useQuery({
    queryKey: fileQueryKey(root, path, repoChangedTick),
    queryFn: () => fsApi.file({ root, path: path as string }),
    enabled: path !== null && enabled,
    staleTime: Infinity,
    refetchInterval: pollMs,
    retry: false,
    placeholderData: keepPreviousData,
  });
}
