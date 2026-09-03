import { describe, expect, test } from "bun:test";
import { sha1_12 } from "./hash";

describe("sha1_12", () => {
  test("returns a 12-char hex digest", () => {
    const h = sha1_12("hello");
    expect(h).toHaveLength(12);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  test("is deterministic and sensitive to input", () => {
    expect(sha1_12("a")).toBe(sha1_12("a"));
    expect(sha1_12("a")).not.toBe(sha1_12("b"));
  });
});
