/** "fetch N 分前" 表示用の相対時刻（ui-redesign.md §5.4）。セッション内 state
 * だけが対象なので秒単位の精度は要らない — 分未満は「たった今」に丸める。 */
export function formatFetchAgo(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 時間前`;
}
