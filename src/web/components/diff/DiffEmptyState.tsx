// 作業ツリーが HEAD と同じ（変更ファイル・untracked ともに 0 件）ときの空状態
// (docs/ui-redesign.md §5.4 Diff / design.pen P11 右)。読み込み中とは呼び出し
// 側（DiffPanel）で区別する — ここは「変更が無いと確定した」ときだけ描く。
import { GitCompare } from "lucide-react";
import { PanelState } from "@/components/ui/status/PanelState";

export function DiffEmptyState({
  branch,
  head,
  onOpenGraph,
}: {
  branch: string | null;
  head: string;
  onOpenGraph: () => void;
}) {
  return (
    <PanelState
      icon={GitCompare}
      title="作業ツリーは HEAD と同じです"
      description={
        <span className="flex items-center gap-2 font-mono">
          {branch && <span>{branch}</span>}
          <span>{head.slice(0, 7)}</span>
        </span>
      }
      action={{ label: "Graph を開く", onClick: onOpenGraph }}
    />
  );
}

export default DiffEmptyState;
