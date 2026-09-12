import { describe, expect, test } from "vitest";
import {
  encodeModifiedEnter,
  encodeShiftArrowWord,
  isInboxToggleKey,
  isMaximizeToggleKey,
} from "./termKeys";

const base = {
  type: "keydown",
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};

describe("encodeModifiedEnter", () => {
  test("plain Enter is left to xterm", () => {
    expect(encodeModifiedEnter(base)).toBeNull();
  });
  test("Shift+Enter → CSI 13;2 u", () => {
    expect(encodeModifiedEnter({ ...base, shiftKey: true })).toBe("\x1b[13;2u");
  });
  test("Alt+Enter → CSI 13;3 u, Ctrl+Enter → 13;5 u", () => {
    expect(encodeModifiedEnter({ ...base, altKey: true })).toBe("\x1b[13;3u");
    expect(encodeModifiedEnter({ ...base, ctrlKey: true })).toBe("\x1b[13;5u");
  });
  test("keyup and IME composition are ignored", () => {
    expect(encodeModifiedEnter({ ...base, type: "keyup", shiftKey: true })).toBeNull();
    expect(encodeModifiedEnter({ ...base, shiftKey: true, isComposing: true })).toBeNull();
  });
});

describe("encodeShiftArrowWord", () => {
  const key = {
    type: "keydown",
    key: "ArrowLeft",
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };

  test.each([
    ["Shift+ArrowLeft", key, "\x1bb"],
    ["Shift+ArrowRight", { ...key, key: "ArrowRight" }, "\x1bf"],
    ["Alt も混ざると対象外", { ...key, altKey: true }, null],
    ["Ctrl も混ざると対象外", { ...key, ctrlKey: true }, null],
    ["Cmd も混ざると対象外", { ...key, metaKey: true }, null],
    ["Shift 無しは対象外", { ...key, shiftKey: false }, null],
    ["IME 変換中は対象外", { ...key, isComposing: true }, null],
    ["ArrowUp は対象外", { ...key, key: "ArrowUp" }, null],
    ["keyup は対象外", { ...key, type: "keyup" }, null],
  ] as const)("%s -> %s", (_label, event, expected) => {
    expect(encodeShiftArrowWord(event)).toBe(expected);
  });
});

describe("isMaximizeToggleKey", () => {
  const key = { type: "keydown", key: "m", shiftKey: true, ctrlKey: false, metaKey: false };

  test.each([
    ["mac ⌘⇧M", { ...key, metaKey: true }, true],
    ["Ctrl+Shift+M", { ...key, ctrlKey: true }, true],
    ["without Shift", { ...key, metaKey: true, shiftKey: false }, false],
    ["without Cmd/Ctrl", key, false],
    ["a different key", { ...key, metaKey: true, key: "n" }, false],
    ["keyup", { ...key, metaKey: true, type: "keyup" }, false],
  ] as const)("%s -> %s", (_label, event, expected) => {
    expect(isMaximizeToggleKey(event)).toBe(expected);
  });
});

describe("isInboxToggleKey", () => {
  const key = { type: "keydown", key: "i", ctrlKey: false, metaKey: false };

  test.each([
    ["mac ⌘I", { ...key, metaKey: true }, true],
    ["Ctrl+I", { ...key, ctrlKey: true }, true],
    ["without Cmd/Ctrl", key, false],
    ["a different key", { ...key, metaKey: true, key: "o" }, false],
    ["keyup", { ...key, metaKey: true, type: "keyup" }, false],
  ] as const)("%s -> %s", (_label, event, expected) => {
    expect(isInboxToggleKey(event)).toBe(expected);
  });
});
