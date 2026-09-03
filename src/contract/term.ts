import * as v from "valibot";

/** client -> server: xterm.js のサイズ変更 */
export const TermResizeMessageSchema = v.object({
  type: v.literal("resize"),
  cols: v.pipe(v.number(), v.integer(), v.minValue(1)),
  rows: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export type TermResizeMessage = v.InferOutput<typeof TermResizeMessageSchema>;

/** server -> client: PTY 終了通知（この直後に WS を close する） */
export const TermExitMessageSchema = v.object({
  type: v.literal("exit"),
  code: v.number(),
});
export type TermExitMessage = v.InferOutput<typeof TermExitMessageSchema>;

/** server -> client のテキストフレームは今のところ exit のみ */
export const TermServerMessageSchema = TermExitMessageSchema;
export type TermServerMessage = v.InferOutput<typeof TermServerMessageSchema>;
