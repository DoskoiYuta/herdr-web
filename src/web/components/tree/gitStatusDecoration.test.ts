import { describe, expect, test } from "vitest";
import { gitStatusLetter } from "./gitStatusDecoration";

describe("gitStatusLetter", () => {
  // 無いと壊れる: untracked が組み込みの "U" のままになり、design.pen の "?" と
  // 揃わない。
  test.each([
    ["modified", "M"],
    ["added", "A"],
    ["deleted", "D"],
    ["renamed", "R"],
    ["untracked", "?"],
  ] as const)("%s maps to %s", (status, letter) => {
    expect(gitStatusLetter(status)).toBe(letter);
  });
});
