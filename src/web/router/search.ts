/** ツール領域ルート（`/focus/$tab` / `/w/$root/$tab`）の search params。
 * タブによって使うキーは違うが、`$tab` は動的な path param なので
 * 検証は 1 つの緩いスキーマで行う — 使わないタブでは該当フィールドを無視する
 * だけでよい。不正な値はフィールドごとに欠落扱い（既定値）へ丸める。 */
import * as v from "valibot";

const ToolSearchSchema = v.object({
  from: v.optional(v.pipe(v.string(), v.minLength(1))),
  to: v.optional(v.pipe(v.string(), v.minLength(1))),
  sub: v.optional(v.string()),
  path: v.optional(v.pipe(v.string(), v.minLength(1))),
  line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  md: v.optional(v.picklist(["source", "preview"])),
});

export type ToolSearch = v.InferOutput<typeof ToolSearchSchema>;

const FIELDS = Object.keys(ToolSearchSchema.entries) as (keyof ToolSearch)[];

/** `validateSearch` 用。URL の search params（文字列 or 未定義）をフィールドごとに
 * `v.safeParse` し、不正/未指定なフィールドは欠落として結果から落とす — 1 つの
 * フィールドの不正値が他のフィールドまで巻き込んで既定値に戻ることはない。
 * TanStack Router の既定 search parser は数字のみの値を JSON として解釈し
 * number に変換してしまう（`?path=123` の path が数値 123 になる）ため、`line`
 * 以外のフィールドは文字列に戻してから検証する。 */
export function parseToolSearch(raw: Record<string, unknown>): ToolSearch {
  const out: Partial<ToolSearch> = {};
  for (const key of FIELDS) {
    const value = raw[key];
    if (value === undefined) continue;
    const candidate = key === "line" ? Number(value) : String(value);
    const schema = ToolSearchSchema.entries[key];
    const result = v.safeParse(schema, candidate);
    if (result.success && result.output !== undefined) {
      (out as Record<string, unknown>)[key] = result.output;
    }
  }
  return out as ToolSearch;
}

export const TOOL_TABS = ["diff", "graph", "files", "docker", "process"] as const;
export type ToolTab = (typeof TOOL_TABS)[number];

export function normalizeTab(raw: string | undefined): ToolTab {
  return (TOOL_TABS as readonly string[]).includes(raw ?? "") ? (raw as ToolTab) : "diff";
}
