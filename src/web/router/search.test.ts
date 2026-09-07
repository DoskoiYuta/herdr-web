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
});
