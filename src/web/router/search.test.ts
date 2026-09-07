import { describe, expect, test } from "vitest";
import { normalizeTab, parseToolSearch, TOOL_TABS } from "./search";

describe("TOOL_TABS", () => {
  // 無いと壊れる: タブの並びが仕様（Files/Graph/Diff/Decisions/Process/Compose）
  // からずれると、TabsList の描画順もずれる。
  test("is ordered Files, Graph, Diff, Decisions, Process, Compose", () => {
    expect(TOOL_TABS).toEqual(["files", "graph", "diff", "decisions", "process", "compose"]);
  });
});

describe("normalizeTab", () => {
  // 無いと壊れる: 旧 URL（?tab=docker）を開くと不明なタブとして Diff に落ちてしまう。
  test("maps the old 'docker' tab value to 'compose'", () => {
    expect(normalizeTab("docker")).toBe("compose");
  });

  test.each([
    ["files", "files"],
    ["decisions", "decisions"],
    ["compose", "compose"],
    ["unknown", "diff"],
    [undefined, "diff"],
  ] as const)("normalizeTab(%s) -> %s", (raw, expected) => {
    expect(normalizeTab(raw)).toBe(expected);
  });
});

describe("parseToolSearch", () => {
  // 無いと壊れる: decisions タブの詳細を開く `id` が URL に反映されない/読み戻せない。
  test("keeps a valid id and drops an empty one", () => {
    expect(parseToolSearch({ id: "abc123" })).toEqual({ id: "abc123" });
    expect(parseToolSearch({ id: "" })).toEqual({});
  });

  // 無いと壊れる: `?inbox=1` をリロードしても Inbox ダイアログが復元されない。
  // TanStack Router の search は JSON で直列化されるため、⌘I で開くと URL は
  // `?inbox=1`（数値）になる。文字列 `"1"` や `true` を渡す呼び出し元が
  // 生じても数値 1 に丸め、不正値は落とす。
  test.each([
    [1, { inbox: 1 }],
    ["1", { inbox: 1 }],
    [true, { inbox: 1 }],
    ["x", {}],
    [0, {}],
    [undefined, {}],
  ] as const)("parseToolSearch({ inbox: %s }) -> %s", (raw, expected) => {
    expect(parseToolSearch({ inbox: raw })).toEqual(expected);
  });

  // 無いと壊れる: old 側にアンカーされた review へのジャンプが side を運べないと、
  // ToolPane の既定 "new" にフォールバックし、無関係な行を開いてしまう。
  test.each([
    ["old", { side: "old" }],
    ["new", { side: "new" }],
    ["other", {}],
    [undefined, {}],
  ] as const)("parseToolSearch({ side: %s }) -> %s", (raw, expected) => {
    expect(parseToolSearch({ side: raw })).toEqual(expected);
  });
});
