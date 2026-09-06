import type { DecisionAttachment, DecisionItemAnswer } from "@contract/decision";

/**
 * 判断依頼ビューの入力途中の回答/添付 (plan F13-7)。決定ビューはツール領域の
 * 排他表示 (App.tsx) の一部として頻繁に unmount/remount されるため、
 * コンポーネントの state ではなくモジュールスコープに置いて生存させる。
 */
export type DecisionDraft = {
  answers: Record<string, DecisionItemAnswer>;
  attachments: DecisionAttachment[];
};

export function emptyDecisionDraft(): DecisionDraft {
  return { answers: {}, attachments: [] };
}

const drafts = new Map<string, DecisionDraft>();

export function getDecisionDraft(id: string): DecisionDraft | undefined {
  return drafts.get(id);
}

export function setDecisionDraft(id: string, draft: DecisionDraft): void {
  drafts.set(id, draft);
}

export function clearDecisionDraft(id: string): void {
  drafts.delete(id);
}

/** Files タブでの場所選択から呼ばれる (plan F13-7)。ビューが unmount されている
 * 間に届くため、既存 draft への追記のみを行う関数として独立させている。 */
export function addDecisionAttachment(id: string, attachment: DecisionAttachment): void {
  const draft = getDecisionDraft(id) ?? emptyDecisionDraft();
  setDecisionDraft(id, { ...draft, attachments: [...draft.attachments, attachment] });
}
