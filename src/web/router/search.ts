/** ツール領域ルート（`/focus/$tab`）の search params。
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
  /** Diff の `path`/`line` がどちら側の行かを固定する。省略時は "new"
   * （ToolPane の既定）。old 側にアンカーされた review へのジャンプ専用。 */
  side: v.optional(v.picklist(["old", "new"])),
  md: v.optional(v.picklist(["source", "preview"])),
  /** worktree が `focus-pane` 経由でまだ切り替わっていない間、他の worktree の
   * `path`/`line` を誤って適用しないためのゲート（別 worktree のファイルを開く
   * 導線専用）。この値が現在の focus worktree と一致した時点で消す。 */
  root: v.optional(v.pipe(v.string(), v.minLength(1))),
  /** decisions タブ専用: 選択中の判断依頼 id。無ければ一覧を描く。`path`/`line`
   * と同様、タブ切替で落とす。 */
  id: v.optional(v.pipe(v.string(), v.minLength(1))),
  /** Inbox ダイアログの開閉（docs/ui-redesign.md §5.4）。タブと違い落とさない —
   * リロードで復元、閉じる操作で消す。 */
  inbox: v.optional(v.literal("1")),
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

export const TOOL_TABS = ["files", "graph", "diff", "decisions", "process", "compose"] as const;
export type ToolTab = (typeof TOOL_TABS)[number];

/** 旧 `"docker"` タブ値（改名前の URL）は `"compose"` に丸める。 */
export function normalizeTab(raw: string | undefined): ToolTab {
  if (raw === "docker") return "compose";
  return (TOOL_TABS as readonly string[]).includes(raw ?? "") ? (raw as ToolTab) : "diff";
}
