import { Badge } from "@/components/ui/badge";

/** タブの通知バッジ（ui-redesign.md §5.4: Diff=未コミット対象の replied レビュー数、
 * Graph=コミット対象の replied レビュー数、Files=replied 質問数、
 * Decisions=フォーカス中 worktree の未回答数）。0 件は描画しない。 */
export function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="default" className="ml-1 h-4.5 min-w-4.5 rounded-full px-1 text-[10px]">
      {count}
    </Badge>
  );
}
