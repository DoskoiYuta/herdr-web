import { expect, test } from "vitest";
import { joinFrontMatter, splitFrontMatter } from "./frontMatter";

test.each([
  ["front matter 無し", "# hello\n\nbody", null, "# hello\n\nbody"],
  ["通常の front matter", "---\ntitle: a\n---\nbody text\n", "---\ntitle: a\n---\n", "body text\n"],
  [
    "... で閉じる front matter",
    "---\ntitle: a\n...\nbody text\n",
    "---\ntitle: a\n...\n",
    "body text\n",
  ],
  ["閉じ区切りが無い", "---\ntitle: a\nbody text\n", null, "---\ntitle: a\nbody text\n"],
  ["先頭に空行がある", "\n---\ntitle: a\n---\nbody\n", null, "\n---\ntitle: a\n---\nbody\n"],
  ["空の front matter", "---\n---\nbody\n", "---\n---\n", "body\n"],
  ["本文無し", "---\ntitle: a\n---\n", "---\ntitle: a\n---\n", ""],
  ["末尾に改行の無い閉じ区切り（本文無し）", "---\ntitle: a\n---", "---\ntitle: a\n---", ""],
])("splitFrontMatter: %s", (_label, input, expectedFrontMatter, expectedBody) => {
  expect(splitFrontMatter(input)).toEqual({
    frontMatter: expectedFrontMatter,
    body: expectedBody,
  });
});

test.each([
  "# hello\n\nbody",
  "---\ntitle: a\n---\nbody text\n",
  "---\ntitle: a\n...\nbody text\n",
  "---\ntitle: a\nbody text\n",
  "\n---\ntitle: a\n---\nbody\n",
  "---\n---\nbody\n",
  "---\ntitle: a\n---\n",
  "---\ntitle: a\n---",
  "",
])("joinFrontMatter(splitFrontMatter(x)) === x: %s", (input) => {
  const { frontMatter, body } = splitFrontMatter(input);
  expect(joinFrontMatter(frontMatter, body)).toBe(input);
});
