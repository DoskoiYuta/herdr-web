import { describe, expect, test } from "vitest";
import type { PaneLayout } from "./paneLayout";
import { layoutToBoxes } from "./paneLayout";

function layout(): PaneLayout {
  return {
    area: { x: 0, y: 0, width: 100, height: 50 },
    panes: [
      {
        paneId: "a",
        focused: true,
        rect: { x: 0, y: 0, width: 50, height: 50 },
        title: "left",
        agent: "claude",
      },
      {
        paneId: "b",
        focused: false,
        rect: { x: 50, y: 0, width: 50, height: 50 },
        title: "right",
        agent: "codex",
      },
    ],
  };
}

describe("layoutToBoxes", () => {
  // Without this, a pane occupying half the tab width/height could render
  // off-scale (e.g. full-width) in the minimap, misleading the user about
  // which pane they're picking.
  test("scales each pane's rect into the target box, preserving its position/size ratio within layout.area", () => {
    const boxes = layoutToBoxes(layout(), 120, 60, "a");
    expect(boxes).toEqual([
      {
        paneId: "a",
        x: 0,
        y: 0,
        width: 60,
        height: 60,
        title: "left",
        agent: "claude",
        focused: true,
        isCandidate: true,
      },
      {
        paneId: "b",
        x: 60,
        y: 0,
        width: 60,
        height: 60,
        title: "right",
        agent: "codex",
        focused: false,
        isCandidate: false,
      },
    ]);
  });

  // Without this, the minimap can't tell the reader which box is "this card's"
  // pane once titles are truncated/missing.
  test("flags only the box matching candidatePaneId", () => {
    const boxes = layoutToBoxes(layout(), 120, 60, "b");
    expect(boxes.find((b) => b.paneId === "a")?.isCandidate).toBe(false);
    expect(boxes.find((b) => b.paneId === "b")?.isCandidate).toBe(true);
  });

  // area offset (x/y not 0) shows up in some multi-tab layouts — without
  // subtracting it, panes would render shifted off the visible minimap box.
  test("accounts for a non-zero area origin", () => {
    const shifted: PaneLayout = {
      area: { x: 10, y: 10, width: 100, height: 100 },
      panes: [
        {
          paneId: "a",
          focused: false,
          rect: { x: 10, y: 10, width: 100, height: 100 },
          title: null,
          agent: null,
        },
      ],
    };
    const [box] = layoutToBoxes(shifted, 100, 100, "a");
    expect(box).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });
});
