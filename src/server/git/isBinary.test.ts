import { describe, expect, test } from "bun:test";
import { isBinary } from "./isBinary";

describe("isBinary", () => {
  test("false for plain text", () => {
    expect(isBinary(Buffer.from("hello world\n"))).toBe(false);
  });

  test("true when a NUL byte appears within the first 8000 bytes", () => {
    expect(isBinary(Buffer.from([104, 101, 0, 108, 111]))).toBe(true);
  });

  test("false when a NUL byte appears only after the 8000-byte scan window", () => {
    const buf = Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])]);
    expect(isBinary(buf)).toBe(false);
  });
});
