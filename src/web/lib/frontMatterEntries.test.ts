import { expect, test } from "vitest";
import {
  parseFrontMatterEntries,
  serializeFrontMatterEntries,
  type FrontMatterEntry,
} from "./frontMatterEntries";

test.each([
  [
    "単純な kv",
    "title: Hello",
    [{ kind: "kv", key: "title", sep: ": ", value: "Hello", raw: "title: Hello" }],
  ],
  [
    "値の中にコロン",
    "time: 10:30",
    [{ kind: "kv", key: "time", sep: ": ", value: "10:30", raw: "time: 10:30" }],
  ],
  [
    "引用符付きの値",
    'title: "hello: world"',
    [
      {
        kind: "kv",
        key: "title",
        sep: ": ",
        value: '"hello: world"',
        raw: 'title: "hello: world"',
      },
    ],
  ],
  [
    "インデント続きの複数行",
    "desc: foo\n  more text",
    [
      {
        kind: "kv",
        key: "desc",
        sep: ": ",
        value: "foo\n  more text",
        raw: "desc: foo\n  more text",
      },
    ],
  ],
  [
    "- リスト続きの複数行",
    "tags:\n  - a\n  - b",
    [
      {
        kind: "kv",
        key: "tags",
        sep: ":",
        value: "\n  - a\n  - b",
        raw: "tags:\n  - a\n  - b",
      },
    ],
  ],
  ["コメント行", "# a comment", [{ kind: "raw", text: "# a comment" }]],
  ["空行", "", [{ kind: "raw", text: "" }]],
  ["区切りに見えない行", "just text", [{ kind: "raw", text: "just text" }]],
])("parseFrontMatterEntries: %s", (_label, input, expected) => {
  expect(parseFrontMatterEntries(input)).toEqual(expected);
});

test.each([
  "title: Hello\n",
  "time: 10:30\ntitle: a\n",
  'title: "hello: world"\n',
  "desc: foo\n  more text\ntags:\n  - a\n  - b\n",
  "title: a\n# comment\n\ntags: [x]\n",
  "no colon here\n",
])("serializeFrontMatterEntries(parseFrontMatterEntries(x)) === x: %s", (input) => {
  expect(serializeFrontMatterEntries(parseFrontMatterEntries(input))).toBe(input);
});

test("値だけ編集した serialize は他の行をバイト単位で保つ", () => {
  const entries = parseFrontMatterEntries("title: a\n# comment\ntags: [x]");
  const edited: FrontMatterEntry[] = entries.map((e) =>
    e.kind === "kv" && e.key === "title" ? { ...e, value: "b" } : e,
  );
  expect(serializeFrontMatterEntries(edited)).toBe("title: b\n# comment\ntags: [x]");
});

test("キーと値がともに空の行は serialize で落ちる", () => {
  const entries: FrontMatterEntry[] = [
    { kind: "kv", key: "title", sep: ": ", value: "a", raw: "title: a" },
    { kind: "kv", key: "", sep: ": ", value: "", raw: "" },
  ];
  expect(serializeFrontMatterEntries(entries)).toBe("title: a");
});
