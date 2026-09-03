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
    const layout = { toolWidth: 400, toolCollapsed: true };
    expect(readLayout(writeLayout(layout))).toEqual(layout);
  });
});
