import { describe, expect, test } from "bun:test";
import { parseKeybind } from "./keybind";

describe("parseKeybind", () => {
  test.each([
    [
      "shift+left",
      { mods: { shift: true, alt: false, ctrl: false, meta: false }, key: "ArrowLeft" },
    ],
    [
      "shift+right",
      { mods: { shift: true, alt: false, ctrl: false, meta: false }, key: "ArrowRight" },
    ],
    ["Cmd+Shift+K", { mods: { shift: true, alt: false, ctrl: false, meta: true }, key: "k" }],
    ["f5", { mods: { shift: false, alt: false, ctrl: false, meta: false }, key: "F5" }],
    ["space", { mods: { shift: false, alt: false, ctrl: false, meta: false }, key: " " }],
    ["opt+a", { mods: { shift: false, alt: true, ctrl: false, meta: false }, key: "a" }],
    ["super+a", { mods: { shift: false, alt: false, ctrl: false, meta: true }, key: "a" }],
    ["shfit+left", null],
    ["shift+", null],
    ["left+shift", null],
    ["", null],
  ] as const)("%s -> %j", (spec, expected) => {
    expect(parseKeybind(spec)).toEqual(expected);
  });
});
