import { describe, expect, test } from "bun:test";
import { flagBool, flagString, parseArgs } from "./args";

describe("parseArgs", () => {
  test("parses boolean and string flags mixed with positionals", () => {
    const r = parseArgs(["--all", "--commit", "abc123", "foo", "bar"], {
      boolean: ["all", "uncommitted"],
      string: ["commit", "since"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags).toEqual({ all: true, commit: "abc123" });
    expect(r.value.positionals).toEqual(["foo", "bar"]);
  });

  test("flags may appear after positionals", () => {
    const r = parseArgs(["show-id", "--json"], { boolean: ["json"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.positionals).toEqual(["show-id"]);
    expect(r.value.flags).toEqual({ json: true });
  });

  test("-- stops flag parsing, rest are positionals verbatim", () => {
    const r = parseArgs(["id1", "--", "-not-a-flag", "--also-not"], { boolean: ["json"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.positionals).toEqual(["id1", "-not-a-flag", "--also-not"]);
    expect(r.value.flags).toEqual({});
  });

  test("unknown flag is a usage error", () => {
    const r = parseArgs(["--bogus"], { boolean: ["json"] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--bogus");
  });

  test("string flag missing its value is a usage error", () => {
    const r = parseArgs(["--commit"], { string: ["commit"] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--commit");
  });

  test("string flag whose value looks like a flag is still consumed", () => {
    const r = parseArgs(["--commit", "--since"], { string: ["commit", "since"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags).toEqual({ commit: "--since" });
  });

  test("empty argv yields empty result", () => {
    const r = parseArgs([], {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.flags).toEqual({});
    expect(r.value.positionals).toEqual([]);
  });
});

describe("flagString / flagBool", () => {
  test("flagString returns the string value or null", () => {
    expect(flagString({ commit: "abc" }, "commit")).toBe("abc");
    expect(flagString({ all: true }, "commit")).toBeNull();
    expect(flagString({}, "commit")).toBeNull();
  });

  test("flagBool returns true only when the flag is literally true", () => {
    expect(flagBool({ all: true }, "all")).toBe(true);
    expect(flagBool({ all: "x" }, "all")).toBe(false);
    expect(flagBool({}, "all")).toBe(false);
  });
});
