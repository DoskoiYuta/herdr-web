/**
 * `GET /api/inbox?worktree=` の集約結果 (docs/ui-redesign.md §5.4)。1 秒ポーリングは
 * せず、review / ask / decision / herdr の変化を受けて再取得する: WS の review /
 * ask / decision イベントは `HerdrStoreContext` の対応する購読フックで、pane の
 * blocked / worktree 解決の変化は `useHerdrState().repos` の参照変化（tree / pane
 * イベントで作り直される、broadcast.ts 参照）で検知する。
 */
import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inboxApi } from "@/lib/api";
import {
  useAskEvents,
  useDecisionEvents,
  useHerdrState,
  useReviewEvents,
} from "@/lib/HerdrStoreContext";

export function inboxQueryKey(worktree: string | undefined) {
  return ["inbox", worktree ?? null] as const;
}

export function useInbox(worktree?: string) {
  const queryClient = useQueryClient();
  const queryKey = inboxQueryKey(worktree);
  const query = useQuery({
    queryKey,
    queryFn: () => inboxApi.get({ worktree }),
    staleTime: Infinity,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["inbox"] });
  }, [queryClient]);

  useReviewEvents(invalidate);
  useAskEvents(invalidate);
  useDecisionEvents(invalidate);

  const { repos } = useHerdrState();
  const mounted = useRef(false);
  useEffect(() => {
    // repos の参照が変わるたび（tree/pane-updated/pane-removed イベント）に
    // 再取得する。マウント直後は useQuery 自身が初回 fetch を行うので、
    // ここで二重に invalidate しない。
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    invalidate();
  }, [repos, invalidate]);

  return query;
}
