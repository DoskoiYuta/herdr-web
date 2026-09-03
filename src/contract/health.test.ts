import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { HealthSchema } from "./health";

describe("HealthSchema", () => {
  test("accepts a valid payload", () => {
    const r = v.safeParse(HealthSchema, {
      ok: true,
      version: "0.1.0",
      herdr: { connected: false, protocol: null },
    });
    expect(r.success).toBe(true);
  });
  test("rejects ok=false", () => {
    expect(
      v.safeParse(HealthSchema, {
        ok: false,
        version: "x",
        herdr: { connected: false, protocol: null },
      }).success,
    ).toBe(false);
  });
});
