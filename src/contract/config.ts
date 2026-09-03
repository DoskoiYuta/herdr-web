import * as v from "valibot";

/** ~/.config/herdr-web/config.json の形。欠けたフィールドは既定値で埋める。 */
export const ConfigSchema = v.object({
  port: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)), 8080),
  host: v.optional(v.string(), "127.0.0.1"),
  herdrSession: v.optional(v.nullable(v.string()), null),
  herdrSocketPath: v.optional(v.nullable(v.string()), null),
  herdrBin: v.optional(v.string(), "herdr"),
  dbPath: v.optional(v.nullable(v.string()), null),
  allowedHosts: v.optional(v.array(v.string()), []),
  allowedRoots: v.optional(v.array(v.string()), []),
  pollIntervalMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(200)), 1000),
  focusPollMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(500)), 3000),
  graphInitialCommits: v.optional(v.pipe(v.number(), v.integer(), v.minValue(10)), 200),
  /** PTY 起動時に process.env から追加で許可する環境変数名（許可リストへの追記） */
  herdrEnvPassthrough: v.optional(v.array(v.string()), []),
  notify: v.optional(
    v.object({
      debounceMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 10_000),
      template: v.optional(
        v.string(),
        "レビューコメントが {count} 件あります。`hw review list` で確認して対応してください。",
      ),
    }),
    {},
  ),
});
export type Config = v.InferOutput<typeof ConfigSchema>;
export type ConfigInput = v.InferInput<typeof ConfigSchema>;
