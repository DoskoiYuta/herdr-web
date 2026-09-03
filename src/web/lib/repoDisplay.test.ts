import { describe, expect, test } from "vitest";
import type { Repo } from "@contract/events";
import { repoDisplayNames } from "./repoDisplay";

function repo(key: string, name: string): Repo {
  return { key, name, worktrees: [], counts: { blocked: 0, done: 0 } };
}

describe("repoDisplayNames", () => {
  test("uses the plain name when there is no collision", () => {
    const names = repoDisplayNames([repo("/work/foo/.git", "foo")]);
    expect(names.get("/work/foo/.git")).toBe("foo");
  });

  test("appends the parent directory when basenames collide", () => {
    const names = repoDisplayNames([repo("/work/foo/.git", "foo"), repo("/side/foo/.git", "foo")]);
    expect(names.get("/work/foo/.git")).toBe("work/foo");
    expect(names.get("/side/foo/.git")).toBe("side/foo");
  });

  test("the 'other' sentinel group is left alone even without a git parent", () => {
    const names = repoDisplayNames([repo("other", "その他")]);
    expect(names.get("other")).toBe("その他");
  });
});
