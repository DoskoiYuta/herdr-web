import { describe, expect, test } from "bun:test";
import { pathUnderAnyRoot } from "./belongsToRoot";

describe("pathUnderAnyRoot", () => {
  test.each([
    ["exact match", "/home/u/repo", ["/home/u/repo"], true],
    ["descendant", "/home/u/repo/sub", ["/home/u/repo"], true],
    ["sibling sharing a string prefix", "/home/u/repo-other", ["/home/u/repo"], false],
    ["unrelated path", "/home/u/other", ["/home/u/repo"], false],
    ["root with a trailing separator", "/home/u/repo/sub", ["/home/u/repo/"], true],
    ["root with a trailing separator, exact", "/home/u/repo", ["/home/u/repo/"], true],
  ])("%s", (_label, path, roots, expected) => {
    expect(pathUnderAnyRoot(path, roots)).toBe(expected);
  });

  test("matches a path under the realpath root even when it doesn't match the raw root", () => {
    // e.g. root = /home/u/repo (a symlink), lsof reports a process cwd
    // under its realpath /var/data/repo — the raw root alone would miss it.
    const rawRoot = "/home/u/repo";
    const realRoot = "/var/data/repo";
    expect(pathUnderAnyRoot("/var/data/repo/sub", [rawRoot, realRoot])).toBe(true);
    expect(pathUnderAnyRoot("/var/data/repo/sub", [rawRoot])).toBe(false);
  });
});
