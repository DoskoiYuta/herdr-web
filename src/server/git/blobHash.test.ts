import { describe, expect, test } from "bun:test";
import { gitBlobHash } from "./blobHash";

describe("gitBlobHash", () => {
  test("matches git's known blob hash for empty content", () => {
    // `git hash-object /dev/null` == e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    expect(gitBlobHash(Buffer.alloc(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  test("matches git's known blob hash for 'hello world'", () => {
    // `echo -n "hello world" | git hash-object --stdin` == 95d09f2b10159347eece71399a7e2e907ea3df4
    expect(gitBlobHash(Buffer.from("hello world"))).toBe(
      "95d09f2b10159347eece71399a7e2e907ea3df4f",
    );
  });
});
