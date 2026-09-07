/**
 * Inbox 件数バッジ (docs/ui-redesign.md §5.1/§5.2)。`useInbox()`（全 worktree、
 * `GET /api/inbox` の `counts.total`）をそのまま返す。読み込み前は `null`
 * ——呼び出し側はこれを「件数不明」として扱い、バッジを出さない。
 */
import { useInbox } from "./useInbox";

export function useInboxCounts(): { data: number | null } {
  const { data } = useInbox();
  return { data: data?.counts.total ?? null };
}
