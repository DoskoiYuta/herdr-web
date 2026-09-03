import * as v from "valibot";

export const LAYOUT_STORAGE_KEY = "herdr-web:layout";

export const TOOL_MIN_WIDTH = 240;
export const TOOL_MAX_WIDTH = 720;
export const TOOL_DEFAULT_WIDTH = 360;

export const LayoutSchema = v.object({
  toolWidth: v.pipe(v.number(), v.minValue(TOOL_MIN_WIDTH), v.maxValue(TOOL_MAX_WIDTH)),
  toolCollapsed: v.boolean(),
});
export type Layout = v.InferOutput<typeof LayoutSchema>;

export const DEFAULT_LAYOUT: Layout = { toolWidth: TOOL_DEFAULT_WIDTH, toolCollapsed: false };

/** localStorage から読んだ生値を valibot で検証する。不正なら既定値を返す */
export function readLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  const result = v.safeParse(LayoutSchema, parsed);
  return result.success ? result.output : DEFAULT_LAYOUT;
}

export function writeLayout(layout: Layout): string {
  return JSON.stringify(layout);
}
