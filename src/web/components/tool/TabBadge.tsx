import { Badge } from "@/components/ui/badge";

/** タブの通知バッジ（ui-redesign.md §5.4: Diff=replied レビュー数、Files=replied
 * 質問数、Decisions=未回答数）。0 件は描画しない。 */
export function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="secondary" className="ml-1 px-1.5">
      {count}
    </Badge>
  );
}
