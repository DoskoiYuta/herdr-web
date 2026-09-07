/**
 * Inbox 件数バッジ (docs/ui-redesign.md §5.1/§5.2)。集約 API は M13 で追加される
 * (`GET /api/inbox`) — それまでは常に `null` を返し、呼び出し側はバッジを出さない。
 */
export function useInboxCounts(): { data: number | null } {
  return { data: null };
}
