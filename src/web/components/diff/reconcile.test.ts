import { test } from "vitest";
import assert from "node:assert/strict";
import { reconcile, summarize } from "./reconcile.ts";
import type { FileDiffMetadata } from "@pierre/diffs";

function fileDiff(name: string, extra: Record<string, unknown> = {}): FileDiffMetadata {
  return { name, type: "change", hunks: [], ...extra } as unknown as FileDiffMetadata;
}

test("reconcile: unchanged file keeps object identity and version", () => {
  const oldFileDiff = fileDiff("a.js");
  const prev = new Map([["a.js", { hash: "h1", fileDiff: oldFileDiff, version: 3 }]]);
  const parsed = [fileDiff("a.js")]; // a *new* fileDiff object from a fresh parse
  const hashes = new Map([["a.js", "h1"]]);

  const { items, next } = reconcile(prev, parsed, hashes);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, "diff:a.js#3"); // id carries the (unchanged) version
  assert.equal(items[0]!.type, "diff");
  assert.equal(items[0]!.fileDiff, oldFileDiff); // identity preserved
  assert.equal(items[0]!.version, 3);
  assert.equal(next.get("a.js")!.fileDiff, oldFileDiff);
  assert.equal(next.get("a.js")!.version, 3);
  assert.equal(next.get("a.js")!.hash, "h1");
});

test("reconcile: changed file gets new object and version+1", () => {
  const oldFileDiff = fileDiff("a.js");
  const newFileDiff = fileDiff("a.js");
  const prev = new Map([["a.js", { hash: "h1", fileDiff: oldFileDiff, version: 3 }]]);
  const parsed = [newFileDiff];
  const hashes = new Map([["a.js", "h2"]]);

  const { items, next } = reconcile(prev, parsed, hashes);

  assert.equal(items[0]!.fileDiff, newFileDiff);
  assert.equal(items[0]!.version, 4);
  // A version bump must produce a *different* id — plan.md's "version を必ず
  // 上げること" note plus the C12 finding: a changed file gets a fresh
  // CodeView instance rather than an in-place item swap.
  assert.equal(items[0]!.id, "diff:a.js#4");
  assert.equal(next.get("a.js")!.hash, "h2");
  assert.equal(next.get("a.js")!.version, 4);
});

test("reconcile: new file gets version 1", () => {
  const prev = new Map();
  const newFileDiff = fileDiff("new.js");
  const parsed = [newFileDiff];
  const hashes = new Map([["new.js", "h1"]]);

  const { items, next } = reconcile(prev, parsed, hashes);

  assert.equal(items[0]!.fileDiff, newFileDiff);
  assert.equal(items[0]!.version, 1);
  assert.equal(items[0]!.id, "diff:new.js#1");
  assert.equal(next.get("new.js")!.version, 1);
});

test("reconcile: duplicate names in a single pass get suffixed ids and map keys (C8)", () => {
  const prev = new Map();
  const first = fileDiff("dup.js");
  const second = fileDiff("dup.js");
  const third = fileDiff("dup.js");
  const parsed = [first, second, third];
  const hashes = new Map([["dup.js", "h1"]]); // hash lookup by name only finds one value

  const { items, next } = reconcile(prev, parsed, hashes);

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.id),
    ["diff:dup.js#1", "diff:dup.js#1#2", "diff:dup.js#1#3"],
  );
  const ids = new Set(items.map((i) => i.id));
  assert.equal(ids.size, 3, "ids must be unique even for duplicate names");

  // Each occurrence gets its own map key so a later reconcile pass can still
  // distinguish them (not just overwrite one another under "dup.js").
  assert.equal(next.size, 3);
  assert.ok(next.has("dup.js"));
  assert.ok(next.has("dup.js#2"));
  assert.ok(next.has("dup.js#3"));
});

test("reconcile: removed file disappears from items and next", () => {
  const oldFileDiff = fileDiff("gone.js");
  const prev = new Map([
    ["gone.js", { hash: "h1", fileDiff: oldFileDiff, version: 1 }],
    ["keep.js", { hash: "h2", fileDiff: fileDiff("keep.js"), version: 1 }],
  ]);
  const keepFileDiff = fileDiff("keep.js");
  const parsed = [keepFileDiff];
  const hashes = new Map([["keep.js", "h2"]]);

  const { items, next } = reconcile(prev, parsed, hashes);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, "diff:keep.js#1");
  assert.equal(next.has("gone.js"), false);
  assert.equal(next.has("keep.js"), true);
});

test("reconcile: item order follows parsedFiles order", () => {
  const prev = new Map();
  const parsed = [fileDiff("b.js"), fileDiff("a.js"), fileDiff("c.js")];
  const hashes = new Map([
    ["b.js", "hb"],
    ["a.js", "ha"],
    ["c.js", "hc"],
  ]);

  const { items } = reconcile(prev, parsed, hashes);

  assert.deepEqual(
    items.map((i) => i.id),
    ["diff:b.js#1", "diff:a.js#1", "diff:c.js#1"],
  );
});

test("reconcile: missing hash for a parsed file is tolerated (treated as changed)", () => {
  const prev = new Map();
  const parsed = [fileDiff("x.js")];
  const hashes = new Map();

  const { items } = reconcile(prev, parsed, hashes);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.version, 1);
});

test("summarize: sums files/additions/deletions from additionLines/deletionLines", () => {
  const files = [
    {
      name: "a.js",
      hunks: [
        { additionLines: 3, deletionLines: 1, additionCount: 10, deletionCount: 8 },
        { additionLines: 2, deletionLines: 0, additionCount: 5, deletionCount: 3 },
      ],
    },
    {
      name: "b.js",
      hunks: [{ additionLines: 0, deletionLines: 4, additionCount: 1, deletionCount: 20 }],
    },
  ];

  const summary = summarize(files as unknown as FileDiffMetadata[]);

  assert.deepEqual(summary, { files: 2, additions: 5, deletions: 5 });
});

test("summarize: handles files with no hunks", () => {
  const files = [{ name: "a.js", hunks: [] }, { name: "b.js" }];
  assert.deepEqual(summarize(files as unknown as FileDiffMetadata[]), {
    files: 2,
    additions: 0,
    deletions: 0,
  });
});

test("summarize: empty list", () => {
  assert.deepEqual(summarize([]), { files: 0, additions: 0, deletions: 0 });
});

test("effectiveDiffStyle: narrow containers fall back to unified, split otherwise", async () => {
  const { effectiveDiffStyle, NARROW_SPLIT_PX } = await import("./reconcile.ts");
  assert.equal(effectiveDiffStyle("split", 1200), "split");
  assert.equal(effectiveDiffStyle("split", NARROW_SPLIT_PX - 1), "unified");
  assert.equal(effectiveDiffStyle("split", null), "split"); // unknown width: trust the setting
  assert.equal(effectiveDiffStyle("unified", 1200), "unified");
});
