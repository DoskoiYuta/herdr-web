import { MessageSquare } from "lucide-react";
import type { LayoutRow } from "./layout/layout";
import { GEOM, nodeCenter, segmentPath } from "./layout/path";
import { PALETTE } from "./layout/colors";
import type { Commit, Ref } from "@contract/git";
import type { ReviewCount } from "@contract/review";
import { relativeTime } from "@/lib/relativeTime";
import RefBadge from "./RefBadge";
import CommitDetail from "./CommitDetail";

export const UNCOMMITTED_HASH = "UNCOMMITTED";

const NODE_RADIUS = 4;

function formatRelative(epochSeconds: number, now: number = Date.now()): string {
  if (!epochSeconds) return "";
  return relativeTime(new Date(epochSeconds * 1000).toISOString(), now);
}

export interface GraphRowProps {
  row: LayoutRow;
  laneCount: number;
  commit: Commit;
  refs: Ref[];
  isHead: boolean;
  selected: boolean;
  /** Whether this row's commit detail is expanded inline below the row. */
  expanded?: boolean;
  /** Repo the expanded detail block should fetch from (unused unless `expanded`). */
  repo?: string;
  /** Note shown in the expanded detail block, e.g. for a root commit. */
  detailNote?: string;
  now?: number;
  /** review 件数バッジ用（F5-10）。unresolved/drafts が両方 0 なら何も出さない。 */
  reviewCount?: ReviewCount;
  onSelect(hash: string, event: { shiftKey: boolean }): void;
  /** Called when the inline detail block's close button is clicked. */
  onCloseDetail?(): void;
  /** 行のダブルクリック（親の diff を選択）。未指定なら出さない。 */
  onOpenDiff?(hash: string): void;
  /** 展開中の詳細でファイル行をクリック（Graph → Diff 遷移）。未指定なら出さない。 */
  onOpenFile?(hash: string, path: string): void;
}

function ReviewCountBadge({ count, onOpenDiff }: { count: ReviewCount; onOpenDiff?(): void }) {
  if (count.unresolved <= 0 && count.drafts <= 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {count.unresolved > 0 && (
        <button
          type="button"
          className="flex items-center gap-0.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/25"
          aria-label={`未解決レビュー ${count.unresolved} 件`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDiff?.();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MessageSquare className="size-3" aria-hidden="true" />
          {count.unresolved}
        </button>
      )}
      {count.drafts > 0 && (
        <button
          type="button"
          className="rounded border border-border px-1 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
          aria-label={`下書きレビュー ${count.drafts} 件`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDiff?.();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          下書き {count.drafts}
        </button>
      )}
    </div>
  );
}

export default function GraphRow({
  row,
  laneCount,
  commit,
  refs,
  isHead,
  selected,
  expanded = false,
  repo = "",
  detailNote,
  now,
  reviewCount,
  onSelect,
  onOpenDiff,
  onOpenFile,
}: GraphRowProps) {
  const isUncommitted = row.hash === UNCOMMITTED_HASH;
  const isMerge = commit.parents.length > 1;
  const { cx, cy } = nodeCenter(row);
  const width = Math.max(1, laneCount) * GEOM.laneWidth;
  const nodeColor = PALETTE[row.color % PALETTE.length];
  // Shared by the row's double-click and its review-count badge (「行の
  // ダブルクリックと同じ挙動」) — a root/uncommitted row has no valid diff to open.
  const triggerOpenDiff = () => {
    if (!isUncommitted && commit.parents.length > 0) onOpenDiff?.(row.hash);
  };

  return (
    <>
      <div
        className={`graph-row flex cursor-pointer items-center gap-2 border-b border-border/50 px-2 font-mono text-xs hover:bg-muted/50 ${
          selected ? "graph-row-selected bg-primary/10" : ""
        } ${isUncommitted ? "graph-row-uncommitted italic opacity-80" : ""}`}
        role="row"
        data-hash={row.hash}
        onClick={(e) => onSelect(row.hash, { shiftKey: e.shiftKey })}
        onDoubleClick={triggerOpenDiff}
        style={{ height: GEOM.rowHeight }}
      >
        <svg
          className="shrink-0"
          width={width}
          height={GEOM.rowHeight}
          viewBox={`0 0 ${width} ${GEOM.rowHeight}`}
        >
          {row.segments.map((seg, i) => (
            <path
              key={i}
              d={segmentPath(seg)}
              stroke={PALETTE[seg.color % PALETTE.length]}
              strokeWidth={2}
              fill="none"
              strokeDasharray={isUncommitted ? "3,3" : undefined}
            />
          ))}
          <circle
            cx={cx}
            cy={cy}
            r={NODE_RADIUS}
            fill={nodeColor}
            stroke={isHead ? "var(--foreground)" : "none"}
            strokeWidth={isHead ? 1.5 : 0}
            strokeDasharray={isUncommitted ? "2,2" : undefined}
          />
          {isMerge && <circle cx={cx} cy={cy} r={NODE_RADIUS - 2} fill={nodeColor} stroke="none" />}
        </svg>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {refs.map((r) => (
            <RefBadge key={r.fullName} name={r.name} type={r.type} isHead={r.isHead} />
          ))}
          <span className="truncate font-sans">
            {isUncommitted ? "(uncommitted changes)" : commit.subject}
          </span>
        </div>
        {reviewCount && <ReviewCountBadge count={reviewCount} onOpenDiff={triggerOpenDiff} />}
        <div className="w-24 shrink-0 truncate text-muted-foreground">{commit.author}</div>
        <div className="w-16 shrink-0 text-right text-muted-foreground">
          {isUncommitted ? "" : formatRelative(commit.authorDate, now)}
        </div>
        <div className="w-16 shrink-0 text-right text-muted-foreground">
          {isUncommitted ? "" : row.hash.slice(0, 7)}
        </div>
      </div>
      {expanded && (
        <div className="graph-row-detail flex items-stretch pl-2" data-hash={row.hash}>
          <div className="relative shrink-0" style={{ width }}>
            {/* Continues each segment's line straight down through the
               expanded block at its `toLane` x position, so the lane the
               line lands in visually connects to the same lane at the top
               of the next row. */}
            <svg
              className="graph-row-detail-gutter-svg absolute inset-0 h-full w-full"
              width={width}
              height="100%"
            >
              {row.segments.map((seg, i) => {
                const x = (seg.toLane + 0.5) * GEOM.laneWidth;
                return (
                  <line
                    key={i}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2="100%"
                    stroke={PALETTE[seg.color % PALETTE.length]}
                    strokeWidth={2}
                    strokeDasharray={isUncommitted ? "3,3" : undefined}
                  />
                );
              })}
            </svg>
          </div>
          <div className="min-w-0 flex-1 py-1 pr-2">
            <CommitDetail
              repo={repo}
              hash={row.hash}
              onOpenFile={
                // ルートコミット（parent 無し）は from を持てない diff にしか
                // ならない（サーバー側の assertCommitish が空木を commit として
                // 拒否する）ので、そもそもクリックできないようにする —
                // クリックできてしまうと「WORKTREE vs HEAD にすり替わる」だけの
                // 遷移になり、ユーザーには別のファイル/コミットを見せられたよう
                // に見える。
                onOpenFile && !isUncommitted && commit.parents.length > 0
                  ? (path) => onOpenFile(row.hash, path)
                  : undefined
              }
              note={detailNote}
            />
          </div>
        </div>
      )}
    </>
  );
}
