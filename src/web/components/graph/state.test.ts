import { describe, expect, test } from "vitest";
import { initialState, reduce } from "./state";

describe("initialState", () => {
  test("defaults", () => {
    const s = initialState();
    expect(s).toEqual({ repo: "", selectedHash: null, all: true, max: 500, detailOpen: false });
  });

  test("accepts overrides", () => {
    const s = initialState({ all: false, max: 100 });
    expect(s.all).toBe(false);
    expect(s.max).toBe(100);
  });
});

describe("reduce", () => {
  test("selectRepo switches repo and clears selection", () => {
    const s0 = { ...initialState(), selectedHash: "abc123", detailOpen: true };
    const s1 = reduce(s0, { type: "selectRepo", repo: "sub/a" });
    expect(s1.repo).toBe("sub/a");
    expect(s1.selectedHash).toBeNull();
    expect(s1.detailOpen).toBe(false);
  });

  test("selectRepo to the same repo is a no-op (keeps selection)", () => {
    const s0 = { ...initialState(), repo: "sub/a", selectedHash: "abc123" };
    const s1 = reduce(s0, { type: "selectRepo", repo: "sub/a" });
    expect(s1).toBe(s0);
  });

  test("selectHash sets the hash without opening detail by default", () => {
    const s1 = reduce(initialState(), { type: "selectHash", hash: "abc123" });
    expect(s1.selectedHash).toBe("abc123");
    expect(s1.detailOpen).toBe(false);
  });

  test("selectHash with openDetail opens the panel", () => {
    const s1 = reduce(initialState(), { type: "selectHash", hash: "abc123", openDetail: true });
    expect(s1.detailOpen).toBe(true);
  });

  test("selectHash preserves an already-open detail panel across cursor moves", () => {
    const s0 = { ...initialState(), selectedHash: "a", detailOpen: true };
    const s1 = reduce(s0, { type: "selectHash", hash: "b" });
    expect(s1.selectedHash).toBe("b");
    expect(s1.detailOpen).toBe(true);
  });

  test("selectHash(null) always closes the detail panel", () => {
    const s0 = { ...initialState(), selectedHash: "a", detailOpen: true };
    const s1 = reduce(s0, { type: "selectHash", hash: null });
    expect(s1.selectedHash).toBeNull();
    expect(s1.detailOpen).toBe(false);
  });

  test("toggleAll flips all", () => {
    const s1 = reduce(initialState(), { type: "toggleAll" });
    expect(s1.all).toBe(false);
    const s2 = reduce(s1, { type: "toggleAll" });
    expect(s2.all).toBe(true);
  });

  test("setAll is idempotent-safe (no-op returns same reference)", () => {
    const s0 = initialState();
    const s1 = reduce(s0, { type: "setAll", all: true });
    expect(s1).toBe(s0);
  });

  test("doubleMax doubles max", () => {
    const s0 = { ...initialState(), max: 500 };
    const s1 = reduce(s0, { type: "doubleMax" });
    expect(s1.max).toBe(1000);
  });

  test("toggleDetail flips detailOpen only when something is selected", () => {
    const s0 = initialState();
    const s1 = reduce(s0, { type: "toggleDetail" });
    expect(s1).toBe(s0); // no-op: nothing selected

    const s2 = { ...s0, selectedHash: "a" };
    const s3 = reduce(s2, { type: "toggleDetail" });
    expect(s3.detailOpen).toBe(true);
    const s4 = reduce(s3, { type: "toggleDetail" });
    expect(s4.detailOpen).toBe(false);
  });

  test("closeDetail closes an open panel", () => {
    const s0 = { ...initialState(), selectedHash: "a", detailOpen: true };
    const s1 = reduce(s0, { type: "closeDetail" });
    expect(s1.detailOpen).toBe(false);
  });

  test("repoUnavailable resets to root and clears selection", () => {
    const s0 = { ...initialState(), repo: "sub/a", selectedHash: "abc", detailOpen: true };
    const s1 = reduce(s0, { type: "repoUnavailable" });
    expect(s1.repo).toBe("");
    expect(s1.selectedHash).toBeNull();
    expect(s1.detailOpen).toBe(false);
  });

  test("repoUnavailable is a no-op when already at root", () => {
    const s0 = initialState();
    const s1 = reduce(s0, { type: "repoUnavailable" });
    expect(s1).toBe(s0);
  });
});
