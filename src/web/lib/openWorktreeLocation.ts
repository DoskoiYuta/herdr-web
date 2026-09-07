/**
 * 別 worktree のファイル位置を開く（ask の「対象ファイルを開く」、判断依頼の
 * `location` Block 共通）。対象が現在の focus worktree と同じなら
 * `/focus/files` へ直接 navigate する。違えば、その worktree に属する pane
 * (`sendTargets.firstPaneAt`) へ herdr のフォーカスを移してから navigate する
 * ——フォーカス切り替えは WS 経由で非同期に届くため、navigate 時点ではまだ
 * 古い worktree が表示中のことがある。ToolPane はここで付ける search の
 * `root` を見て、その worktree に実際に切り替わるまで `path`/`line` を
 * 適用しない（plan.md F14-4）。対象 worktree に pane が無ければ、navigate
 * せずに toast で知らせる（docs/ui-redesign.md §5.6: 一過性メッセージは共通の toast に統一する）。
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { firstPaneAt } from "@/lib/sendTargets";

export function useOpenWorktreeLocation() {
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const toast = useToast();

  const openLocation = useCallback(
    (location: { worktreeRoot: string; path: string; line: number }) => {
      if (state.focus?.worktreeRoot === location.worktreeRoot) {
        void navigate({
          to: "/focus/$tab",
          params: { tab: "files" },
          search: { path: location.path, line: location.line },
        });
        return;
      }
      const pane = firstPaneAt(state.repos, location.worktreeRoot);
      if (!pane) {
        toast({ kind: "warning", message: "この worktree の pane が herdr にありません" });
        return;
      }
      send({ type: "focus-pane", pane });
      void navigate({
        to: "/focus/$tab",
        params: { tab: "files" },
        search: { path: location.path, line: location.line, root: location.worktreeRoot },
      });
    },
    [state.focus, state.repos, send, navigate, toast],
  );

  return { openLocation };
}
