import * as v from "valibot";
import { DecisionItemAnswerSchema } from "@contract/decision";

/**
 * 判断依頼ビューの入力途中の回答 (plan F13-7)。決定ビューはツール領域の
 * 排他表示 (App.tsx) の一部として頻繁に unmount/remount されるためこの
 * モジュールに persist し、さらにブラウザのリロードをまたいで残るよう
 * localStorage に保存する（viewerSettings.ts と同じく読み書きは try/catch
 * で失敗を無視する — プライベートモード等 localStorage が使えない環境でも
 * アプリ自体は壊さない）。
 */
export type DecisionDraft = {
  answers: Record<string, v.InferOutput<typeof DecisionItemAnswerSchema>>;
};

export function emptyDecisionDraft(): DecisionDraft {
  return { answers: {} };
}

const DraftSchema = v.object({ answers: v.record(v.string(), DecisionItemAnswerSchema) });

function storageKey(id: string): string {
  return `herdr-web:decision-draft:${id}`;
}

export function getDecisionDraft(id: string): DecisionDraft | undefined {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return undefined;
    const parsed = v.safeParse(DraftSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : undefined;
  } catch {
    return undefined;
  }
}

export function setDecisionDraft(id: string, draft: DecisionDraft): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(draft));
  } catch {
    // localStorage が使えない環境では永続化を諦める
  }
}

/** 送信・却下・取り下げなど、依頼が非 open になったら呼ぶ。 */
export function clearDecisionDraft(id: string): void {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    // 上記と同様
  }
}
