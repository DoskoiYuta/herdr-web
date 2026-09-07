/**
 * 別 worktree のファイル位置を開く（ask の「対象ファイルを開く」、判断依頼の
 * `location` Block 共通）。対象が現在の focus worktree と同じなら
 * `/focus/files` へ直接 navigate する。違えば、その worktree に属する pane
 * (`sendTargets.firstPaneAt`) へ herdr のフォーカスを移してから navigate する
 * ——フォーカス切り替えは WS 経由で非同期に届くため、navigate 時点ではまだ
 * 古い worktree が表示中のことがある。ToolPane はここで付ける search の
 * `root` を見て、その worktree に実際に切り替わるまで `path`/`line` を
 * 適用しない（plan.md F14-4）。対象 worktree に pane が無ければ、navigate
 * せずに一時メッセージを返す。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { firstPaneAt } from "@/lib/sendTargets";

export function useOpenWorktreeLocation() {
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const openLocation = useCallback(
    (location: { worktreeRoot: string; path: string; line: number }) => {
      setMessage(null);
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
        setMessage("この worktree の pane が herdr にありません");
        return;
      }
      send({ type: "focus-pane", pane });
      void navigate({
        to: "/focus/$tab",
        params: { tab: "files" },
        search: { path: location.path, line: location.line, root: location.worktreeRoot },
      });
    },
    [state.focus, state.repos, send, navigate],
  );

  return { openLocation, message };
}
