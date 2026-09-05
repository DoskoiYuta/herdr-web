import { describe, expect, test } from "bun:test";
import { previewKindForPath } from "./preview";

describe("previewKindForPath", () => {
  test.each([
    ["a.png", "image"],
    ["a.PNG", "image"],
    ["a.jpg", "image"],
    ["a.jpeg", "image"],
    ["a.gif", "image"],
    ["a.webp", "image"],
    ["a.avif", "image"],
    ["a.bmp", "image"],
    ["a.ico", "image"],
    ["a.svg", "image"],
    ["dir/a.pdf", "pdf"],
    ["a.PDF", "pdf"],
    ["a.txt", null],
    ["a.ts", null],
    ["noext", null],
    [".gitignore", null],
  ] as const)("%s -> %s", (path, expected) => {
    expect(previewKindForPath(path)).toBe(expected);
  });
});
