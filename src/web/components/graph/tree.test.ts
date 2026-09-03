import { describe, expect, test } from "vitest";
import { buildFileTree } from "./tree";
import type { CommitFile } from "@contract/git";

function f(path: string, status: CommitFile["status"] = "M", oldPath?: string): CommitFile {
  const base = { status, path, additions: 1, deletions: 1 };
  return oldPath ? { ...base, oldPath } : base;
}

describe("buildFileTree", () => {
  test("empty file list yields empty tree", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  test("a single file at the root", () => {
    const tree = buildFileTree([f("README.md")]);
    expect(tree).toEqual([
      { name: "README.md", path: "README.md", kind: "file", file: f("README.md") },
    ]);
  });

  test("multiple directory levels build a nested tree", () => {
    const files = [f("src/client/App.tsx"), f("src/server/index.ts")];
    const tree = buildFileTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: "src", path: "src", kind: "dir" });
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children?.[0]).toMatchObject({
      name: "client",
      path: "src/client",
      kind: "dir",
    });
    expect(tree[0]!.children?.[0]!.children).toEqual([
      { name: "App.tsx", path: "src/client/App.tsx", kind: "file", file: files[0] },
    ]);
    expect(tree[0]!.children?.[1]).toMatchObject({
      name: "server",
      path: "src/server",
      kind: "dir",
    });
  });

  test("a chain of single-child directories collapses into one node", () => {
    const files = [f("src/client/components/App.tsx"), f("src/client/components/GraphView.tsx")];
    const tree = buildFileTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      name: "src/client/components",
      path: "src/client/components",
      kind: "dir",
    });
    expect(tree[0]!.children).toHaveLength(2);
  });

  test("a directory with a single file child does not collapse into that file", () => {
    const files = [f("src/index.ts")];
    const tree = buildFileTree(files);
    expect(tree).toEqual([
      {
        name: "src",
        path: "src",
        kind: "dir",
        children: [{ name: "index.ts", path: "src/index.ts", kind: "file", file: files[0] }],
      },
    ]);
  });

  test("directories sort before files, both alphabetically", () => {
    const files = [f("b.ts"), f("a.ts"), f("zdir/x.ts"), f("adir/y.ts")];
    const tree = buildFileTree(files);
    expect(tree.map((n) => n.name)).toEqual(["adir", "zdir", "a.ts", "b.ts"]);
  });

  test("a rename is placed at the new path, with oldPath carried on the file", () => {
    const files = [f("src/c.ts", "R", "src/b.ts")];
    const tree = buildFileTree(files);
    expect(tree[0]).toMatchObject({ name: "src", kind: "dir" });
    const fileNode = tree[0]!.children?.[0];
    expect(fileNode).toMatchObject({ name: "c.ts", path: "src/c.ts", kind: "file" });
    expect(fileNode?.file?.oldPath).toBe("src/b.ts");
  });
});
