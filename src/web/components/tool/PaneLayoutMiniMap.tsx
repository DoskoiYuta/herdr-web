import type { PaneLayout } from "./paneLayout";
import { layoutToBoxes } from "./paneLayout";

const WIDTH = 120;
const HEIGHT = 72;
/** Below this a box's title would overflow its own rect, so we skip the label. */
const MIN_LABEL_WIDTH = 28;
const MIN_LABEL_HEIGHT = 16;

export type PaneLayoutMiniMapProps = {
  layout: PaneLayout;
  candidatePaneId: string;
};

/** Small SVG map of a tab's panes, scaled from `layout.area` (herdr cell
 * units) — the candidate pane filled with the accent color, others outlined
 * with their title/agent when the box is big enough to hold it. */
export function PaneLayoutMiniMap({ layout, candidatePaneId }: PaneLayoutMiniMapProps) {
  const boxes = layoutToBoxes(layout, WIDTH, HEIGHT, candidatePaneId);

  return (
    <svg
      role="img"
      aria-label="pane layout"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      // inline size: the card is a shadcn Button whose `[&_svg]:size-4` would otherwise shrink it
      style={{ width: WIDTH, height: HEIGHT }}
      className="shrink-0 rounded-sm bg-muted/40"
    >
      {boxes.map((box) => {
        const showLabel = box.width >= MIN_LABEL_WIDTH && box.height >= MIN_LABEL_HEIGHT;
        const label = box.title ?? box.agent;
        return (
          <g key={box.paneId}>
            <rect
              x={box.x + 1}
              y={box.y + 1}
              width={Math.max(box.width - 2, 0)}
              height={Math.max(box.height - 2, 0)}
              rx={2}
              className={
                box.isCandidate ? "fill-primary/70 stroke-primary" : "fill-background stroke-border"
              }
              strokeWidth={box.focused ? 2 : 1}
            />
            {showLabel && label && (
              <text
                x={box.x + 4}
                y={box.y + 12}
                className={
                  box.isCandidate
                    ? "fill-primary-foreground text-[7px]"
                    : "fill-muted-foreground text-[7px]"
                }
              >
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
