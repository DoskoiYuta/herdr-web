import type { PanePreviewResponse } from "@contract/herdr-ops";

export type PaneLayout = NonNullable<PanePreviewResponse["layout"]>;

export type PaneBox = {
  paneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string | null;
  agent: string | null;
  focused: boolean;
  isCandidate: boolean;
};

/**
 * Scales `layout.area` (herdr cell units) into a `width`×`height` px box,
 * one output rect per `layout.panes[]` at the same position/size ratio, and
 * flags whichever pane is `candidatePaneId` (the card's own pane).
 */
export function layoutToBoxes(
  layout: PaneLayout,
  width: number,
  height: number,
  candidatePaneId: string,
): PaneBox[] {
  const { area } = layout;
  const scaleX = area.width > 0 ? width / area.width : 0;
  const scaleY = area.height > 0 ? height / area.height : 0;

  return layout.panes.map((pane) => ({
    paneId: pane.paneId,
    x: (pane.rect.x - area.x) * scaleX,
    y: (pane.rect.y - area.y) * scaleY,
    width: pane.rect.width * scaleX,
    height: pane.rect.height * scaleY,
    title: pane.title,
    agent: pane.agent,
    focused: pane.focused,
    isCandidate: pane.paneId === candidatePaneId,
  }));
}
