// 作業ツリーが HEAD と同じ（変更ファイル・untracked ともに 0 件）ときの空状態
// (docs/ui-redesign.md §5.4 Diff / design.pen P11 右)。読み込み中とは呼び出し
// 側（DiffPanel）で区別する — ここは「変更が無いと確定した」ときだけ描く。
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <p>作業ツリーは HEAD と同じです</p>
      <div className="flex items-center gap-2 font-mono text-xs">
        {branch && (
          <span className="flex items-center gap-1">
            <GitBranch className="size-3.5" aria-hidden="true" />
            {branch}
          </span>
        )}
        <span>{head.slice(0, 7)}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onOpenGraph}>
        Graph を開く
      </Button>
    </div>
  );
}

export default DiffEmptyState;
