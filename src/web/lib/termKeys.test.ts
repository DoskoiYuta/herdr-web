import { describe, expect, test } from "vitest";
import { encodeModifiedEnter } from "./termKeys";

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
