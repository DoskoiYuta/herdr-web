/**
 * Inbox 件数バッジ (docs/ui-redesign.md §5.1/§5.2)。集約 API がまだ無いため常に
 * `null` を返す — 呼び出し側はこれを「件数不明」として扱い、バッジを出さない。
 */
export function useInboxCounts(): { data: number | null } {
  return { data: null };
}
