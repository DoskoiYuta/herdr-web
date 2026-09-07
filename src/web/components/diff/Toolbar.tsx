// Trimmed port of terminal-diff's src/client/components/Toolbar.tsx.
// Dropped: the repo/submodule <select> (M3 scope has no submodule concept),
// the theme toggle (herdr-web's theme is a global `.dark` class, not a
// per-panel setting) and the close button (no "quit" flow here). Restyled
// with the shadcn Button component instead of raw CSS.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ViewerControls } from "@/components/tool/ViewerControls";
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
  /** Collapse every file in the diff (M3 follow-up: per-file collapse). */
  onCollapseAll(): void;
  /** Expand every file in the diff. */
  onExpandAll(): void;
  disabled: boolean;
  /** レビュー下書きの一括送信ボタン（ui-redesign.md §5.4: Diff でしか使わない
   * ので、ここに置く）。`SendDraftsButton` 自身が 0 件なら null を返す。 */
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
  onCollapseAll,
  onExpandAll,
  disabled,
  sendButton,
}: ToolbarProps) {
  return (
    <div id="toolbar" className="flex items-center gap-1 border-b border-border p-1">
      <ViewerControls
        showTree={showTree}
        onToggleTree={onToggleTree}
        onFontDec={onFontDec}
        onFontInc={onFontInc}
        disabled={disabled}
      />
      <Button
        id="btn-diffstyle"
        type="button"
        variant="ghost"
        size="sm"
        title="split / unified"
        onClick={onToggleDiffStyle}
        disabled={disabled}
      >
        {settings.diffStyle === "split" ? "⇄ split" : "≡ unified"}
      </Button>
      <Button
        id="btn-overflow"
        type="button"
        variant="ghost"
        size="sm"
        title="wrap / scroll"
        onClick={onToggleOverflow}
        disabled={disabled}
      >
        {settings.overflow === "wrap" ? "↵ wrap" : "⇥ scroll"}
      </Button>
      <Button
        id="btn-collapse-all"
        type="button"
        variant="ghost"
        size="sm"
        title="すべて折りたたむ"
        onClick={onCollapseAll}
        disabled={disabled}
      >
        すべて折りたたむ
      </Button>
      <Button
        id="btn-expand-all"
        type="button"
        variant="ghost"
        size="sm"
        title="すべて展開"
        onClick={onExpandAll}
        disabled={disabled}
      >
        すべて展開
      </Button>
      <span className="flex-1" />
      <Button
        id="btn-refresh"
        type="button"
        variant="ghost"
        size="sm"
        title="更新 (r)"
        onClick={onRefresh}
        disabled={disabled}
      >
        ↻
      </Button>
      {sendButton}
    </div>
  );
}
