// Ported from terminal-diff's src/client/components/StatusLine.tsx,
// restyled with Tailwind utility classes instead of raw CSS.

import type { Summary } from "./reconcile.ts";

export interface StatusLineProps {
  summary: Summary;
  generatedAt: string | null;
  untrackedCount: number;
  untrackedErrors: number;
}

export default function StatusLine({
  summary,
  generatedAt,
  untrackedCount,
  untrackedErrors,
}: StatusLineProps) {
  const time = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("ja-JP", { hour12: false })
    : "--:--:--";
  const untrackedPart = untrackedCount > 0 ? ` / 未追跡 ${untrackedCount}` : "";
  const untrackedErrorsPart = untrackedErrors > 0 ? ` / 未追跡エラー ${untrackedErrors}` : "";
  return (
    <div id="status" className="border-b border-border px-2 py-1 text-xs text-muted-foreground">
      {`更新 ${time} — ${summary.files} files +${summary.additions} -${summary.deletions}${untrackedPart}${untrackedErrorsPart}`}
    </div>
  );
}
