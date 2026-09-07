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
