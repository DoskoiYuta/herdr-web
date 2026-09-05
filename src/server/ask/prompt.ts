import type { Anchor } from "../../contract/review";

/** placeholders 置換に使う値。`{id}` は完全な id（末尾 8 文字ではない）。 */
export type PromptContext = {
  id: string;
  path: string;
  anchor: Anchor;
  question: string;
};

function replaceAll(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : match,
  );
}

/** `template` の `{id}/{path}/{startLine}/{endLine}/{code}/{question}` を埋める。 */
export function renderAskPrompt(template: string, ctx: PromptContext): string {
  const startLine = ctx.anchor.lineHint;
  const endLine = startLine + ctx.anchor.lines.length - 1;
  return replaceAll(template, {
    id: ctx.id,
    path: ctx.path,
    startLine: String(startLine),
    endLine: String(endLine),
    code: ctx.anchor.lines.join("\n"),
    question: ctx.question,
  });
}

/** `replyTemplate` の `{id}` を埋める。 */
export function renderAskReplyPrompt(template: string, id: string): string {
  return replaceAll(template, { id });
}
