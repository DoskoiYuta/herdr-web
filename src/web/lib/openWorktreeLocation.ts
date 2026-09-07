/**
 * 別 worktree のファイル位置を開く（ask の「対象ファイルを開く」、判断依頼の
 * `location` Block、Inbox の行クリック共通）。対象が現在の focus worktree と
 * 同じなら `tab`（既定 "files"）へ直接 navigate する。違えば、その worktree に
 * 属する pane (`sendTargets.firstPaneAt`) へ herdr のフォーカスを移してから
 * navigate する ——フォーカス切り替えは WS 経由で非同期に届くため、navigate
 * 時点ではまだ古い worktree が表示中のことがある。ToolPane はここで付ける
 * search の `root` を見て、その worktree に実際に切り替わるまで `path`/`line`
 * を適用しない（plan.md F14-4）。対象 worktree に pane が無ければ、navigate
 * せずに toast で知らせる（docs/ui-redesign.md §5.6: 一過性メッセージは共通の toast に統一する）。
 * `path`/`line` を省略すると（Inbox の「送信待ち」行のように場所を持たない場合）
 * タブを開くだけで search には触れない。
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { firstPaneAt } from "@/lib/sendTargets";
import type { ToolTab } from "@/router/search";

export type WorktreeLocation = {
  worktreeRoot: string;
  path?: string;
  line?: number;
  /** 既定 "files"（ask / 判断依頼の導線）。Inbox のレビュー行は "diff"。 */
  tab?: Extract<ToolTab, "files" | "diff">;
  /** Diff だけが使う。省略時 ToolPane の既定 "new"。old 側にアンカーされた
   * review へのジャンプ専用（Inbox の replied レビュー行）。 */
  side?: "old" | "new";
  /** Diff だけが使う。commit ターゲットの review の比較範囲（`hash~1`..`hash`）。 */
  from?: string;
  to?: string;
};

export function useOpenWorktreeLocation() {
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const toast = useToast();

  const openLocation = useCallback(
    (location: WorktreeLocation) => {
      const tab = location.tab ?? "files";
      const locationSearch =
        location.path !== undefined
          ? {
              path: location.path,
              line: location.line,
              side: location.side,
              from: location.from,
              to: location.to,
            }
          : {};

      if (state.focus?.worktreeRoot === location.worktreeRoot) {
        void navigate({ to: "/focus/$tab", params: { tab }, search: locationSearch });
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
        params: { tab },
        search: { ...locationSearch, root: location.worktreeRoot },
      });
    },
    [state.focus, state.repos, send, navigate, toast],
  );

  return { openLocation };
}
