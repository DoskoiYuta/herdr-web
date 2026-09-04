import type { Review } from "../../../contract/review";

/**
 * agent 向けレスポンスから下書きエントリを落とす。送信済みメッセージが一つも
 * 無くなる review は agent には存在しないのと同じなので null を返す
 * （呼び出し側で list からは除外、get なら 404 にする）。
 */
export function stripDraftsForAgent(review: Review): Review | null {
  const thread = review.thread.filter((e) => !e.draft);
  if (thread.length === 0) return null;
  return { ...review, thread };
}
