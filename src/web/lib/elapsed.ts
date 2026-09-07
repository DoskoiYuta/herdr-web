/** Compact elapsed-time label (`3d4h`, `12m30s`, …) shared by Compose and
 * Process (ui-redesign.md §5.4: same look for both tabs' row metadata). */
export function formatElapsedSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${secs}s`;
  return `${secs}s`;
}

/** `createdAt` from `/api/docker/containers` isn't guaranteed parseable in
 * every Docker version's output — an unparseable date has no elapsed time
 * to show rather than a nonsensical one. */
export function formatElapsedSince(isoDate: string, now: number = Date.now()): string | null {
  const ms = Date.parse(isoDate);
  if (Number.isNaN(ms)) return null;
  return formatElapsedSeconds((now - ms) / 1000);
}
