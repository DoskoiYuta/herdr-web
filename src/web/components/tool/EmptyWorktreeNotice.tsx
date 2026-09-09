import { FolderX } from "lucide-react";
import { PanelState } from "@/components/ui/status/PanelState";

/** 観察タブ（Files/Graph/Diff/Notes/Decisions/Process/Compose）の worktree
 * 未選択時の空状態。タブ列はこの状態でも常に描画する。起動直後や全 pane
 * クローズ後でも herdr が再接続してくるまでタブ自体には触れられるようにする
 * ため。 */
export function EmptyWorktreeNotice() {
  return (
    <PanelState
      icon={FolderX}
      title="worktree を解決できません"
      description={
        <>
          ツール領域はフォーカス pane のリポジトリとワークスペースに追従します（worktree
          はヘッダーで選びます）。herdr に接続して pane をフォーカスすると表示されます。
          <br />
          Inbox は接続中も参照できます（回答の配達は再接続後）
        </>
      }
    />
  );
}
