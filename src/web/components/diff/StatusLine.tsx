// Ported from terminal-diff's src/client/components/StatusLine.tsx,
// restyled with Tailwind utility classes instead of raw CSS. design.pen
// (P8/P11) folds this into the toolbar's single row and drops the visible
// "更新 hh:mm:ss" timestamp — it's kept as a hover tooltip instead of a
// removed feature.

import type { Summary } from "./reconcile.ts";

export interface StatusLineProps {
  summary: Summary;
  generatedAt: string | null;
  untrackedCount: number;
  untrackedErrors: number;
  className?: string;
}

export function formatDiffStats(
  summary: Summary,
  untrackedCount: number,
  untrackedErrors: number,
): string {
  const parts = [`${summary.files} files +${summary.additions} -${summary.deletions}`];
  if (untrackedCount > 0) parts.push(`untracked ${untrackedCount}`);
  if (untrackedErrors > 0) parts.push(`untracked errors ${untrackedErrors}`);
  return parts.join(" · ");
}

export default function StatusLine({
  summary,
  generatedAt,
  untrackedCount,
  untrackedErrors,
  className,
}: StatusLineProps) {
  const time = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("ja-JP", { hour12: false })
    : "--:--:--";
  return (
    <span id="status" className={className} title={`更新 ${time}`}>
      {formatDiffStats(summary, untrackedCount, untrackedErrors)}
    </span>
  );
}
