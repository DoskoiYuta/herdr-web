// Single-row toolbar (design.pen P8/P11): a compare-range chip + stats on
// the left, icon buttons + the send-drafts slot on the right.

import {
  ChevronsDownUp,
  ChevronsUpDown,
  PanelLeft,
  RefreshCw,
  SquareSplitHorizontal,
  WrapText,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatusLine from "./StatusLine.tsx";
import type { Summary } from "./reconcile.ts";
import type { Settings } from "./state.ts";

export interface ToolbarProps {
  settings: Settings;
  showTree: boolean;
  onToggleTree(): void;
  onToggleDiffStyle(): void;
  onToggleOverflow(): void;
  onFontDec(): void;
  onFontInc(): void;
  onRefresh(): void;
  /** Whether every file in the diff is currently collapsed — drives both
   * the icon shown and which action a click performs (design.pen shows one
   * button, not separate collapse-all/expand-all controls). */
  allCollapsed: boolean;
  onToggleCollapseAll(): void;
  disabled: boolean;
  /** "WORKTREE vs HEAD" or an explicit "abc1234 → def5678" range label. */
  compareLabel: string;
  /** True when `from`/`to` came from an explicit Graph selection rather
   * than the default worktree-vs-HEAD comparison — shows the chip's clear
   * button. */
  compareRangeActive: boolean;
  onResetToWorktree?: () => void;
  summary: Summary;
  generatedAt: string | null;
  untrackedCount: number;
  untrackedErrors: number;
  /** レビュー下書きの一括送信ボタン（ui-redesign.md §5.4: Diff でしか使わない
   * ので、ここに置く）。比較範囲が有効なときも出す — 作業ツリーに戻る手段は
   * chip の × だけで足りる。 */
  sendButton?: ReactNode;
}

export default function Toolbar({
  settings,
  showTree,
  onToggleTree,
  onToggleDiffStyle,
  onToggleOverflow,
  onFontDec,
  onFontInc,
  onRefresh,
  allCollapsed,
  onToggleCollapseAll,
  disabled,
  compareLabel,
  compareRangeActive,
  onResetToWorktree,
  summary,
  generatedAt,
  untrackedCount,
  untrackedErrors,
  sendButton,
}: ToolbarProps) {
  return (
    <div id="toolbar" className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Badge
          variant={compareRangeActive ? "outline" : "secondary"}
          className="shrink-0 gap-1 font-mono"
        >
          {compareLabel}
          {compareRangeActive && (
            <button
              id="btn-clear-range"
              type="button"
              title="比較範囲を解除"
              onClick={onResetToWorktree}
              className="-mr-0.5 rounded-full p-0.5 hover:bg-muted"
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </Badge>
        <StatusLine
          summary={summary}
          generatedAt={generatedAt}
          untrackedCount={untrackedCount}
          untrackedErrors={untrackedErrors}
          className="truncate text-muted-foreground"
        />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          id="btn-diffstyle"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="split / unified"
          aria-pressed={settings.diffStyle === "split"}
          onClick={onToggleDiffStyle}
          disabled={disabled}
        >
          <SquareSplitHorizontal aria-hidden />
        </Button>
        <Button
          id="btn-tree"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="ファイルツリー"
          aria-pressed={showTree}
          onClick={onToggleTree}
          disabled={disabled}
        >
          <PanelLeft aria-hidden />
        </Button>
        <Button
          id="btn-collapse-all"
          type="button"
          variant="ghost"
          size="icon-sm"
          title={allCollapsed ? "すべて展開" : "すべて折りたたむ"}
          aria-pressed={allCollapsed}
          onClick={onToggleCollapseAll}
          disabled={disabled}
        >
          {allCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
        </Button>
        <Button
          id="btn-refresh"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="更新 (r)"
          onClick={onRefresh}
          disabled={disabled}
        >
          <RefreshCw aria-hidden />
        </Button>
        <Button
          id="btn-overflow"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="wrap / scroll"
          aria-pressed={settings.overflow === "wrap"}
          onClick={onToggleOverflow}
          disabled={disabled}
        >
          <WrapText aria-hidden />
        </Button>
        <Button
          id="btn-font-dec"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="文字を小さく"
          onClick={onFontDec}
          disabled={disabled}
          className="text-xs"
        >
          A-
        </Button>
        <Button
          id="btn-font-inc"
          type="button"
          variant="ghost"
          size="icon-sm"
          title="文字を大きく"
          onClick={onFontInc}
          disabled={disabled}
          className="text-xs"
        >
          A+
        </Button>
        {sendButton}
      </div>
    </div>
  );
}
