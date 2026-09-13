// mergeMarkdownEdit のテストは Tiptap の実際の往復結果を fixture として使う
// （`roundtrip` が headless の `@tiptap/core` Editor で original →
// normalized を作る）— 手書きの normalized 文字列だと、実装が仮定している
// シリアライズの癖（`*` → `-`、front matter の破壊、末尾改行の欠落など）と
// 食い違ってテストが無意味になる。
import { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { expect, test } from "vitest";
import { mergeMarkdownEdit } from "./markdownMerge";

function roundtrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, TableKit, TaskList, TaskItem.configure({ nested: false }), Markdown],
    content: markdown,
    contentType: "markdown",
  });
  const markdownOut = editor.getMarkdown();
  editor.destroy();
  return markdownOut;
}

test.each([
  { name: "先頭の HTML コメント", original: "<!-- keep me -->\n\n# h\n\npara\n" },
  { name: "末尾の HTML コメント", original: "# h\n\npara\n\n<!-- keep me -->\n" },
  { name: "末尾の参照定義", original: "see [x]\n\npara\n\n[x]: http://example.com\n" },
  { name: "末尾の連続空行", original: "# h\n\npara\n\n\n" },
  { name: "front matter", original: "---\ntitle: X\ndate: 2020\n---\n\n# h\n\nintro\n" },
  {
    name: "表で終わる文書",
    original: "# heading\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n",
  },
  { name: "* リストで終わる文書", original: "# h\n\n* a\n* b\n" },
])("無編集 ($name) なら merged が original と一致する（恒等性）", ({ original }) => {
  const normalized = roundtrip(original);
  const { merged, normalizedRegions } = mergeMarkdownEdit({
    original,
    normalized,
    edited: normalized,
  });
  expect(merged).toBe(original);
  expect(normalizedRegions).toBe(0);
});

test("表の直後に段落を挿入しても表は 1 つのまま残る", () => {
  const original = "# h\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\npara\n";
  const normalized = roundtrip(original);
  const edited = normalized.replace("\n\npara", "\n\nnew para\n\npara");
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  const tableOccurrences = merged.split("| a | b |").length - 1;
  expect(tableOccurrences).toBe(1);
  expect(merged).toContain("new para");
});

test("* リストの先頭に項目を挿入すると記号が * に揃い、正規化領域は増えない", () => {
  const original = "# h\n\n* a\n* b\n\npara\n";
  const normalized = roundtrip(original);
  const edited = normalized.replace("- a", "- z\n- a");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# h\n\n* z\n* a\n* b\n\npara\n");
  expect(normalizedRegions).toBe(0);
});

test("表のセルを編集しても、表の前後に空行が増えない", () => {
  // 表はどのセルを直しても丸ごと正規化された桁揃えの書式になる（表という
  // ブロック単位でしか original との対応が取れないため）。ここで問うのは
  // 桁揃えの有無ではなく、その際に前後の空行が増減しないこと。
  const original = "# h\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\npara\n";
  const normalized = roundtrip(original);
  expect(normalized).toContain("| 1   | 2   |"); // fixture の前提確認（桁揃え）
  const edited = normalized.replace("| 1   | 2   |", "| 9   | 2   |");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# h\n\n| a   | b   |\n| --- | --- |\n| 9   | 2   |\n\npara\n");
  expect(normalizedRegions).toBe(1);
});

test("参照定義がある文書で本文だけ編集しても定義は残る", () => {
  const original = "see [x]\n\npara\n\n[x]: http://example.com\n";
  const normalized = roundtrip(original);
  const edited = normalized.replace("para", "para changed");
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("see [x]\n\npara changed\n\n[x]: http://example.com\n");
});

test("正規化されたリストを残したまま別段落を編集すると元の記号が保たれる", () => {
  const original = "# heading\n\n* item one\n* item two\n\npara after";
  const normalized = roundtrip(original);
  expect(normalized).toContain("- item one"); // fixture の前提確認（`*` → `-`）
  const edited = normalized.replace("para after", "para after changed");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading\n\n* item one\n* item two\n\npara after changed");
  expect(normalizedRegions).toBe(0);
});

test("正規化された段落自体を編集すると、その段落だけ正規化された書式で保存される", () => {
  const original = "# heading\n\n* item one\n* item two\n\npara after";
  const normalized = roundtrip(original);
  const edited = normalized.replace("item two", "item two changed");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading\n\n- item one\n- item two changed\n\npara after");
  expect(normalizedRegions).toBe(1);
});

test.each([
  {
    name: "先頭が空行",
    original: "\n# Mixed\n\npara\n\n* a\n* b\n",
    headingBefore: "# Mixed",
    headingAfter: "# Mixed Edited",
    expected: "\n# Mixed Edited\n\npara\n\n* a\n* b\n",
  },
  {
    name: "先頭が HTML コメント + 空行",
    original: "<!-- x -->\n\n# h\n\npara\n\n* a\n* b\n",
    headingBefore: "# h",
    headingAfter: "# h Edited",
    expected: "<!-- x -->\n\n# h Edited\n\npara\n\n* a\n* b\n",
  },
])(
  "$name の本文で最初の見出しを編集しても先頭部分が保たれる",
  ({ original, headingBefore, headingAfter, expected }) => {
    const normalized = roundtrip(original);
    const edited = normalized.replace(headingBefore, headingAfter);
    const { merged } = mergeMarkdownEdit({ original, normalized, edited });
    expect(merged).toBe(expected);
  },
);

test.each([
  { name: "original が末尾改行あり", original: "para one\n\npara two\n" },
  { name: "original が末尾改行なし", original: "para one\n\npara two" },
])("末尾改行の有無は $name に従う", ({ original }) => {
  const normalized = roundtrip(original);
  const edited = normalized.replace("para two", "para two changed");
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged.endsWith("\n")).toBe(original.endsWith("\n"));
});
