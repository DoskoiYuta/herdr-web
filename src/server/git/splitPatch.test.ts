import { describe, expect, test } from "bun:test";
import { sha1_12 } from "./hash";
import { splitPatchByFile } from "./splitPatch";

const OLD40 = "1111111111111111111111111111111111111111";
const NEW40 = "2222222222222222222222222222222222222222";
const ZERO40 = "0".repeat(40);

const CHANGE = `diff --git a/src/app.js b/src/app.js
index ${OLD40}..${NEW40} 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 line1
+line2
 line3
 line4
`;

const NEW_FILE = `diff --git a/new.txt b/new.txt
new file mode 100644
index ${ZERO40}..${NEW40}
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
`;

const DELETED_FILE = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index ${OLD40}..${ZERO40}
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-hello
`;

const RENAME_CHANGED = `diff --git a/old.txt b/renamed.txt
similarity index 90%
rename from old.txt
rename to renamed.txt
index ${OLD40}..${NEW40} 100644
--- a/old.txt
+++ b/renamed.txt
@@ -1 +1 @@
-hello
+hello world
`;

const RENAME_PURE = `diff --git a/pure-old.txt b/pure-new.txt
similarity index 100%
rename from pure-old.txt
rename to pure-new.txt
`;

const MODE_ONLY = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`;

const BINARY = `diff --git a/image.png b/image.png
index ${OLD40}..${NEW40} 100644
Binary files a/image.png and b/image.png differ
`;

describe("splitPatchByFile", () => {
  test("empty patch -> []", () => {
    expect(splitPatchByFile("")).toEqual([]);
  });

  test("normal change: name, hashes, text", () => {
    const [piece] = splitPatchByFile(CHANGE);
    expect(piece?.name).toBe("src/app.js");
    expect(piece?.prevName).toBeNull();
    expect(piece?.oldHash).toBe(OLD40);
    expect(piece?.newHash).toBe(NEW40);
    expect(piece?.text).toBe(CHANGE);
    expect(piece?.hash).toBe(sha1_12(CHANGE));
  });

  test("new file: oldHash null (all-zeros), newHash set", () => {
    const [piece] = splitPatchByFile(NEW_FILE);
    expect(piece?.name).toBe("new.txt");
    expect(piece?.oldHash).toBeNull();
    expect(piece?.newHash).toBe(NEW40);
  });

  test("deleted file: newHash null (all-zeros), oldHash set, name from --- a/X", () => {
    const [piece] = splitPatchByFile(DELETED_FILE);
    expect(piece?.name).toBe("old.txt");
    expect(piece?.oldHash).toBe(OLD40);
    expect(piece?.newHash).toBeNull();
  });

  test("rename with content change: prevName set from rename from/to", () => {
    const [piece] = splitPatchByFile(RENAME_CHANGED);
    expect(piece?.name).toBe("renamed.txt");
    expect(piece?.prevName).toBe("old.txt");
    expect(piece?.oldHash).toBe(OLD40);
    expect(piece?.newHash).toBe(NEW40);
  });

  test("pure rename: no index line -> hashes null, name/prevName from rename lines", () => {
    const [piece] = splitPatchByFile(RENAME_PURE);
    expect(piece?.name).toBe("pure-new.txt");
    expect(piece?.prevName).toBe("pure-old.txt");
    expect(piece?.oldHash).toBeNull();
    expect(piece?.newHash).toBeNull();
  });

  test("mode-only change: fallback header parse, no index, no rename", () => {
    const [piece] = splitPatchByFile(MODE_ONLY);
    expect(piece?.name).toBe("script.sh");
    expect(piece?.prevName).toBeNull();
  });

  test("binary file: no ---/+++, name via fallback header parse, hashes from index", () => {
    const [piece] = splitPatchByFile(BINARY);
    expect(piece?.name).toBe("image.png");
    expect(piece?.oldHash).toBe(OLD40);
    expect(piece?.newHash).toBe(NEW40);
  });

  test("multiple files split correctly, in order, each with own hash", () => {
    const patch = CHANGE + NEW_FILE + DELETED_FILE;
    const pieces = splitPatchByFile(patch);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]?.name).toBe("src/app.js");
    expect(pieces[1]?.name).toBe("new.txt");
    expect(pieces[2]?.name).toBe("old.txt");
    const hashes = new Set(pieces.map((p) => p.hash));
    expect(hashes.size).toBe(3);
  });

  test("copy to/from is treated like rename for prevName", () => {
    const COPY = `diff --git a/orig.txt b/copy.txt
similarity index 100%
copy from orig.txt
copy to copy.txt
`;
    const [piece] = splitPatchByFile(COPY);
    expect(piece?.name).toBe("copy.txt");
    expect(piece?.prevName).toBe("orig.txt");
  });
});
