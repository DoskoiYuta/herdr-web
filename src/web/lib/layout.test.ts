import { describe, expect, test } from "vitest";
import { DEFAULT_LAYOUT, readLayout, writeLayout } from "./layout";

describe("readLayout", () => {
  test("returns defaults for null / invalid JSON / schema violations", () => {
    expect(readLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(readLayout("not json")).toEqual(DEFAULT_LAYOUT);
    expect(readLayout(JSON.stringify({ toolWidth: 1, toolCollapsed: false }))).toEqual(
      DEFAULT_LAYOUT,
    );
    expect(readLayout(JSON.stringify({ toolWidth: "nope" }))).toEqual(DEFAULT_LAYOUT);
  });

  test("round-trips a valid layout", () => {
    const layout = {
      toolWidth: 400,
      toolCollapsed: true,
      sidebar: { width: 300, collapsed: true },
    };
    expect(readLayout(writeLayout(layout))).toEqual(layout);
  });

  test("old values without a sidebar field stay valid and get the default sidebar", () => {
    const old = { toolWidth: 400, toolCollapsed: false };
    expect(readLayout(JSON.stringify(old))).toEqual({ ...old, sidebar: DEFAULT_LAYOUT.sidebar });
  });
});
