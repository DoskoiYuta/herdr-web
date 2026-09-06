import type { DecisionAnswer, DecisionItem, DecisionSpec } from "../../contract/decision";

function isAnswered(
  item: DecisionItem,
  answer: DecisionAnswer["answers"][string] | undefined,
): boolean {
  if (!answer) return false;
  if (answer.selected.length > 0) return true;
  if (item.kind === "text" || (item.allowOther ?? true)) {
    return (answer.other ?? "").trim().length > 0;
  }
  return false;
}

/**
 * spec に対して回答を検査する (plan F13-7)。サーバー側で信用できない入力
 * （未知の item id、options に無い label、confirm の不正値、single の複数選択、
 * 必須未回答）を弾く — クライアントのバリデーションはバイパスできるため。
 */
export function validateDecisionAnswer(spec: DecisionSpec, answer: DecisionAnswer): string | null {
  const itemsById = new Map(spec.items.map((item) => [item.id, item]));

  for (const itemId of Object.keys(answer.answers)) {
    if (!itemsById.has(itemId)) return `unknown item id: ${itemId}`;
  }

  for (const item of spec.items) {
    const a = answer.answers[item.id];

    if (item.required !== false && !isAnswered(item, a)) {
      return `item "${item.id}" is required`;
    }
    if (!a) continue;

    if (item.kind === "confirm") {
      if (
        a.selected.length > 0 &&
        !(a.selected.length === 1 && (a.selected[0] === "yes" || a.selected[0] === "no"))
      ) {
        return `item "${item.id}" (confirm) must be answered "yes" or "no"`;
      }
    }

    if (item.kind === "single" && a.selected.length > 1) {
      return `item "${item.id}" (single) cannot have more than one selection`;
    }

    if ((item.kind === "single" || item.kind === "multi") && item.allowOther === false) {
      const labels = new Set(item.options.map((o) => o.label));
      for (const selected of a.selected) {
        if (!labels.has(selected)) {
          return `item "${item.id}": "${selected}" is not one of its options`;
        }
      }
    }
  }

  return null;
}
