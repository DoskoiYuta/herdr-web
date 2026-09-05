// TanStack Query wrapper around fsApi.ls(), one query per directory
// (`useQueries`) so each expanded directory refetches independently on its
// own poll tick instead of one failing subdirectory invalidating the whole
// tree. Mirrors useFile/useGraph's tick/poll-driven refetch pattern
// (staleTime: Infinity, invalidated by `repoChangedTick` or `pollMs`).

import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { fsApi } from "@/lib/api";

export function lsQueryKey(root: string, dir: string, repoChangedTick: number) {
  return ["ls", root, dir, repoChangedTick] as const;
}

export interface UseLsError {
  dir: string;
  error: unknown;
}

export interface UseLsResult {
  paths: string[];
  errors: UseLsError[];
}

/** `dir === ""` is `root` itself; a trailing `/` marks a directory path
 * for @pierre/trees (see node_modules/@pierre/trees/dist/path-store/src/canonical.js
 * `createCompareEntry`) — an empty directory still renders a chevron
 * (render/FileTreeView.js), so a lazily-unlisted directory isn't a dead end. */
export function useLs(
  root: string,
  dirs: string[],
  repoChangedTick: number,
  pollMs?: number,
): UseLsResult {
  const results = useQueries({
    queries: dirs.map((dir) => ({
      queryKey: lsQueryKey(root, dir, repoChangedTick),
      queryFn: () => fsApi.ls({ root, dir }),
      staleTime: Infinity,
      refetchInterval: pollMs,
      retry: false,
      placeholderData: keepPreviousData,
    })),
  });

  return useMemo(() => {
    const paths: string[] = [];
    const errors: UseLsError[] = [];
    results.forEach((result, i) => {
      const dir = dirs[i];
      if (dir === undefined) return;
      if (result.isError) {
        errors.push({ dir, error: result.error });
        return;
      }
      if (!result.data) return;
      for (const entry of result.data.entries) {
        const name = dir === "" ? entry.name : `${dir}/${entry.name}`;
        paths.push(entry.kind === "dir" ? `${name}/` : name);
      }
    });
    return { paths, errors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, dirs]);
}
