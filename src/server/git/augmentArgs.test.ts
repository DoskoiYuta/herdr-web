import { describe, expect, test } from "bun:test";
import { augmentArgs, bareCandidates } from "./augmentArgs";

describe("augmentArgs", () => {
  test("empty args -> [HEAD]", () => {
    expect(augmentArgs([])).toEqual(["HEAD"]);
  });

  test("[-w] -> [-w, HEAD]", () => {
    expect(augmentArgs(["-w"])).toEqual(["-w", "HEAD"]);
  });

  test("[--, src/] -> [HEAD, --, src/]", () => {
    expect(augmentArgs(["--", "src/"])).toEqual(["HEAD", "--", "src/"]);
  });

  test("[--staged] unchanged", () => {
    expect(augmentArgs(["--staged"])).toEqual(["--staged"]);
  });

  test("[--cached, -w] unchanged", () => {
    expect(augmentArgs(["--cached", "-w"])).toEqual(["--cached", "-w"]);
  });

  test("[HEAD~3] unchanged", () => {
    expect(augmentArgs(["HEAD~3"])).toEqual(["HEAD~3"]);
  });

  test("[main..feature] unchanged", () => {
    expect(augmentArgs(["main..feature"])).toEqual(["main..feature"]);
  });

  test("does not mutate input array", () => {
    const input: string[] = [];
    const result = augmentArgs(input);
    expect(input).toEqual([]);
    expect(result).not.toBe(input);
  });

  test("custom headRev is used for empty args", () => {
    const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    expect(augmentArgs([], emptyTree)).toEqual([emptyTree]);
  });

  test("[-U, 5] -> [-U, HEAD, 5]: -U is not value-taking, 5 is an unresolved pathspec", () => {
    expect(augmentArgs(["-U", "5"], "HEAD", () => false)).toEqual(["-U", "HEAD", "5"]);
  });

  test("[-S, foo, main] unchanged: main is still recognized as a revision", () => {
    expect(augmentArgs(["-S", "foo", "main"])).toEqual(["-S", "foo", "main"]);
  });

  test("[--unified=5] -> HEAD appended (= form never consumed a value)", () => {
    expect(augmentArgs(["--unified=5"])).toEqual(["--unified=5", "HEAD"]);
  });

  test("injectable isRevision: false for every candidate -> HEAD inserted before the candidate", () => {
    expect(augmentArgs(["main"], "HEAD", () => false)).toEqual(["HEAD", "main"]);
  });

  test("injectable isRevision: true for candidate -> unchanged, predicate consulted", () => {
    const calls: string[] = [];
    const result = augmentArgs(["main"], "HEAD", (arg) => {
      calls.push(arg);
      return true;
    });
    expect(result).toEqual(["main"]);
    expect(calls).toEqual(["main"]);
  });

  test("[--diff-algorithm, patience] value-taking, HEAD appended", () => {
    expect(augmentArgs(["--diff-algorithm", "patience"])).toEqual([
      "--diff-algorithm",
      "patience",
      "HEAD",
    ]);
  });

  test("[--color-moved, main] unchanged: --color-moved does not consume a separate value", () => {
    expect(augmentArgs(["--color-moved", "main"])).toEqual(["--color-moved", "main"]);
  });
});

describe("bareCandidates", () => {
  test("skips options and their separate values", () => {
    expect(bareCandidates(["-w", "-S", "foo", "src", "--", "x"])).toEqual(["src"]);
    expect(bareCandidates(["--staged"])).toEqual([]);
  });
});
