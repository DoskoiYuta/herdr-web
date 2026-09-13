// mergeMarkdownEdit のテストは Tiptap の実際の往復結果を fixture として使う
// （`buildFixture` が headless の `@tiptap/core` Editor で original →
// normalized を作る）— 手書きの normalized 文字列だと、実装が仮定している
// シリアライズの癖（`*` → `-`、末尾改行の欠落など）と食い違ってテストが
// 無意味になる。
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

test("original と normalized が同一なら edited をそのまま採用する", () => {
  const original = "para one\n\npara two";
  const normalized = roundtrip(original);
  expect(normalized).toBe(original); // fixture の前提確認
  const edited = "para one\n\npara two changed";
  const result = mergeMarkdownEdit({ original, normalized, edited });
  expect(result).toEqual({ merged: edited, normalizedRegions: 0 });
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
  const edited = normalized.replace("- item two", "- item two\n- item three");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading\n\n- item one\n- item two\n- item three\n\npara after");
  expect(normalizedRegions).toBe(1);
});

test("末尾に新しい段落を追加しても、触っていないリストの記号は保たれる", () => {
  const original = "# heading\n\n* item one\n* item two\n\npara after";
  const normalized = roundtrip(original);
  const edited = `${normalized}\n\nappended para`;
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading\n\n* item one\n* item two\n\npara after\n\nappended para");
  expect(normalizedRegions).toBe(0);
});

test("段落を削除しても、触っていないリストの記号は保たれる", () => {
  const original = "# heading\n\n* item one\n* item two\n\npara one\n\npara two";
  const normalized = roundtrip(original);
  const edited = normalized.replace("para one\n\n", "");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading\n\n* item one\n* item two\n\npara two");
  expect(normalizedRegions).toBe(0);
});

test.each([
  { name: "original が末尾改行あり", original: "para one\n\npara two\n" },
  { name: "original が末尾改行なし", original: "para one\n\npara two" },
])("末尾改行の有無は $name に従う", ({ original }) => {
  const normalized = roundtrip(original);
  const edited = normalized.replace("para two", "para two changed");
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged.endsWith("\n")).toBe(original.endsWith("\n"));
});

test("front matter を触らずに見出しだけ編集すると、front matter は失われない", () => {
  // front matter の 2 つ目の区切り線 (`---`) は Tiptap の往復で消える
  // （見出し化された 1 行目に吸収される）— normalized 側にその行の対応が
  // 一切残らないため、対応する original 側の内容が出力から丸ごと抜け落ち
  // ていた（実走で発見: front matter の 2 行目 `title: ...` が保存後に
  // 消えていた）。
  const original = "---\ntitle: Mixed\n---\n\n# heading\n\nintro paragraph\n";
  const normalized = roundtrip(original);
  expect(normalized).not.toContain("title: Mixed\n---"); // fixture の前提確認
  const edited = normalized.replace("heading", "heading changed");
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("---\ntitle: Mixed\n---\n\n# heading changed\n\nintro paragraph\n");
});

test("表で終わるファイルは、無関係な編集の保存で末尾に空行が増えない", () => {
  // 実走で発見: 表が最後のブロックだと、ブラウザにマウントされた実際の
  // エディタは ProseMirror のスキーマ整合（表の直後に空段落を挿む）を
  // 走らせ、headless な roundtrip では出ない空行が `edited` 側にだけ現れる
  // — 見出しを直しただけなのに保存のたびに末尾へ空行が増えていた。
  const original = "# heading\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n";
  const normalized = original.replace(/\n$/, "");
  const edited = `${normalized.replace("# heading", "# heading changed")}\n\n`;
  const { merged } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading changed\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
});

test("表の桁揃えを触らずに見出しだけ編集すると、表は元の書式のまま残る", () => {
  const original = "# heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const normalized = roundtrip(original);
  expect(normalized).not.toContain("| a | b |"); // fixture の前提確認（桁が揃えられる）
  const edited = normalized.replace("# heading", "# heading changed");
  const { merged, normalizedRegions } = mergeMarkdownEdit({ original, normalized, edited });
  expect(merged).toBe("# heading changed\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  expect(normalizedRegions).toBe(0);
});
