// Tree-toggle and font-size controls shared by Diff's and Files' toolbars
// (plan.md F3/F9), so the two viewers look identical for these controls.

import { Button } from "@/components/ui/button";

export interface ViewerControlsProps {
  showTree: boolean;
  onToggleTree(): void;
  onFontDec(): void;
  onFontInc(): void;
  disabled?: boolean;
}

export function ViewerControls({
  showTree,
  onToggleTree,
  onFontDec,
  onFontInc,
  disabled = false,
}: ViewerControlsProps) {
  return (
    <>
      <Button
        id="btn-tree"
        type="button"
        variant="ghost"
        size="sm"
        title="ファイルツリー"
        aria-pressed={showTree}
        onClick={onToggleTree}
        disabled={disabled}
      >
        ☰ tree
      </Button>
      <Button
        id="btn-font-dec"
        type="button"
        variant="ghost"
        size="sm"
        title="文字を小さく"
        onClick={onFontDec}
        disabled={disabled}
      >
        A-
      </Button>
      <Button
        id="btn-font-inc"
        type="button"
        variant="ghost"
        size="sm"
        title="文字を大きく"
        onClick={onFontInc}
        disabled={disabled}
      >
        A+
      </Button>
    </>
  );
}

export default ViewerControls;
