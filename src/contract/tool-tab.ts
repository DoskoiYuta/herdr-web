import * as v from "valibot";

/** ツール領域タブの列挙 — `src/web/router/search.ts`（URL の正）と
 * `src/server`（永続化・focus メッセージ）の両方から使うため contract に置く。 */
export const TOOL_TABS = [
  "files",
  "graph",
  "diff",
  "notes",
  "decisions",
  "process",
  "compose",
] as const;
export type ToolTab = (typeof TOOL_TABS)[number];
export const ToolTabSchema = v.picklist(TOOL_TABS);

/** 旧 `"docker"` タブ値（改名前の URL）は `"compose"` に丸める。 */
export function normalizeTab(raw: string | undefined): ToolTab {
  if (raw === "docker") return "compose";
  return (TOOL_TABS as readonly string[]).includes(raw ?? "") ? (raw as ToolTab) : "diff";
}
