import { describe, expect, test } from "vitest";
import { languageLabel } from "./languageLabel";

describe("languageLabel", () => {
  // 無いと壊れる: Files ヘッダの language 表示が常に出ない、または既知の
  // 拡張子でも null になる。
  test.each([
    ["src/app.ts", "TypeScript"],
    ["docs/readme.md", "Markdown"],
    ["assets/logo.png", null],
    ["Makefile", null],
  ])("maps %s to %s", (path, expected) => {
    expect(languageLabel(path)).toBe(expected);
  });
});
