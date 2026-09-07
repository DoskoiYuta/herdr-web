import type { PaneRow } from "@contract/events";
import type { DecisionStatus } from "@contract/decision";

/** turnOf("decision", status) folds open→action, answered/dismissed→done,
 * cancelled→void — StatusChip's default per-turn label can't tell answered
 * apart from dismissed. This is the Decision-specific label override
 * (docs/ui-redesign.md §5.4). */
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  open: "未回答",
  answered: "回答済み",
  dismissed: "却下",
  cancelled: "取り下げ",
};

/** `hw` が呼び出し元 pane を解決できなかった依頼は `decision.agent` が
 * null のことがある — その場合も pane が herdr state に見つかれば pane 側の
 * `agent` を出す（実走で確認: 空欄/「?」になっていた）。 */
export function agentLabel(decisionAgent: string | null, pane: PaneRow | null): string {
  return decisionAgent ?? pane?.agent ?? "エージェント不明";
}
