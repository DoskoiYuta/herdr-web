import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { DecisionSpecSchema, decisionSpecJsonSchema } from "./decision";

const baseItem = { id: "q1", header: "h", question: "some question?", kind: "single" as const };

describe("DecisionSpecSchema", () => {
  // 無いと壊れる: 設問ゼロの依頼が作れてしまい、回答フォームが空のまま送信可能になる。
  test("rejects a spec with zero items", () => {
    const result = v.safeParse(DecisionSpecSchema, { items: [] });
    expect(result.success).toBe(false);
  });

  // 無いと壊れる: item id が重複したまま作れてしまい、回答が `answers` の
  // キーで上書きされて一方の設問の回答が消える。
  test("rejects duplicate item ids", () => {
    const result = v.safeParse(DecisionSpecSchema, {
      items: [
        { ...baseItem, id: "q1" },
        { ...baseItem, id: "q1" },
      ],
    });
    expect(result.success).toBe(false);
  });

  // 無いと壊れる: item id が空文字のまま作れてしまい、短縮 id 解決や
  // `answers` のキーとして扱えない設問ができる。
  test("rejects an empty item id", () => {
    const result = v.safeParse(DecisionSpecSchema, { items: [{ ...baseItem, id: "" }] });
    expect(result.success).toBe(false);
  });

  // 無いと壊れる: 同じ item 内で option label が重複し、UI のチェック状態が
  // どちらの選択肢を指しているか区別できなくなる。
  test("rejects duplicate option labels within one item", () => {
    const result = v.safeParse(DecisionSpecSchema, {
      items: [{ ...baseItem, options: [{ label: "A" }, { label: "A" }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("decisionSpecJsonSchema", () => {
  // 無いと壊れる: `hw decision schema` / GET /api/decision/schema が壊れた
  // 出力を返しても気づけない（CLI の事前検証・ドキュメントの両方の出所）。
  test("returns a JSON Schema object describing the spec", () => {
    const schema = decisionSpecJsonSchema() as { type?: string; properties?: object };
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("items");
  });
});
