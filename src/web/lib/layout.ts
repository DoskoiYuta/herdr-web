import * as v from "valibot";

export const LAYOUT_STORAGE_KEY = "herdr-web:layout";

export const TOOL_MIN_WIDTH = 240;
export const TOOL_MAX_WIDTH = 1400;
export const TOOL_DEFAULT_WIDTH = 640;

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 240;

/** どちらの側を最大化しているか。既定は `null`（等分/現状比率）。D7: Terminal /
 * Tool 両方に最大化を持たせ、同じキーで戻す。 */
export const MaximizedSchema = v.nullable(v.picklist(["terminal", "tool"]));
export type Maximized = v.InferOutput<typeof MaximizedSchema>;

// 旧レイアウト（sidebar / maximized フィールド無し）を読み込んでも既定値で
// 補完できるよう、両方 optional として定義し、読み込み後に DEFAULT_LAYOUT で
// マージする。
export const LayoutSchema = v.object({
  toolWidth: v.pipe(v.number(), v.minValue(TOOL_MIN_WIDTH), v.maxValue(TOOL_MAX_WIDTH)),
  toolCollapsed: v.boolean(),
  sidebar: v.optional(
    v.object({
      width: v.pipe(v.number(), v.minValue(SIDEBAR_MIN_WIDTH), v.maxValue(SIDEBAR_MAX_WIDTH)),
      collapsed: v.boolean(),
    }),
  ),
  maximized: v.optional(MaximizedSchema),
});
export type Layout = v.InferOutput<typeof LayoutSchema>;

export const DEFAULT_LAYOUT: Layout = {
  toolWidth: TOOL_DEFAULT_WIDTH,
  toolCollapsed: false,
  sidebar: { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false },
  maximized: null,
};

/** localStorage から読んだ生値を valibot で検証する。不正なら既定値を返す。
 * 旧バージョンが書いた `sidebar`/`maximized` 無しの値も有効として扱い、既定値で補う。 */
export function readLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  const result = v.safeParse(LayoutSchema, parsed);
  if (!result.success) return DEFAULT_LAYOUT;
  return {
    ...result.output,
    sidebar: result.output.sidebar ?? DEFAULT_LAYOUT.sidebar,
    maximized: result.output.maximized ?? null,
  };
}

export function writeLayout(layout: Layout): string {
  return JSON.stringify(layout);
}
