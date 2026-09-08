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
  terminal: v.optional(
    v.object({
      /** ブラウザ側のフォント。Nerd Font を先頭に置く。 */
      fontFamily: v.optional(
        v.string(),
        '"BitstromWera Nerd Font Mono", "JetBrainsMono Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", Menlo, monospace',
      ),
      fontSize: v.optional(v.pipe(v.number(), v.minValue(8), v.maxValue(40)), 13),
      lineHeight: v.optional(v.pipe(v.number(), v.minValue(0.8), v.maxValue(2)), 1.0),
    }),
    {},
  ),
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
  ask: v.optional(
    v.object({
      template: v.optional(
        v.string(),
        [
          "これは herdr-web の質問 (ask) {id} です。コードベースの既存箇所についての質問で、変更依頼ではありません。",
          "対象: {path} 行 {startLine}-{endLine}",
          "```",
          "{code}",
          "```",
          "質問: {question}",
          "",
          '回答は `hw ask reply {id} "<本文>"` で返してください（何度でも可）。詳細は `hw ask show {id}`。',
          '`hw` が見つからない場合は `bun run hw ask reply {id} "<本文>"` をリポジトリルートで実行してください。',
          "ファイルを編集したくなった場合は、先に `hw ask reply` で提案を伝え、ユーザーの許可を得てから編集してください。",
        ].join("\n"),
      ),
      replyTemplate: v.optional(
        v.string(),
        "質問 {id} にユーザーから返信があります。`hw ask show {id}` で読み、`hw ask reply {id}` で回答してください。",
      ),
      maxSessions: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 5),
      /** herdr `agent.start` の `kind` として選べる値。herdr 自体は自由文字列を
       * 取り対応一覧を持たないため（`herdr agent start --help` にしか出ない）、
       * ここで持つ。 */
      agents: v.optional(v.array(v.string()), ["claude", "codex", "gemini"]),
      /** `agents` に無ければ起動時に `agents[0]` へ丸める（server/config.ts）。 */
      defaultAgent: v.optional(v.string(), "claude"),
    }),
    {},
  ),
});
export type Config = v.InferOutput<typeof ConfigSchema>;
export type ConfigInput = v.InferInput<typeof ConfigSchema>;

/** GET /api/config でフロントに渡す部分。 */
export const ClientConfigSchema = v.object({
  terminal: v.object({ fontFamily: v.string(), fontSize: v.number(), lineHeight: v.number() }),
  graphInitialCommits: v.number(),
  ask: v.object({
    agents: v.array(v.string()),
    defaultAgent: v.string(),
    /** 専用ワークスペースの同時起動上限（送信先ダイアログの残り枠表示用）。 */
    maxSessions: v.number(),
  }),
  /** 設定ダイアログの「接続」タブに出す、このサーバーが読んでいるファイルの
   * 実パス。herdr 自体の socket パスは API に無いのでここには含めない。 */
  paths: v.object({ config: v.string(), db: v.string() }),
});
export type ClientConfig = v.InferOutput<typeof ClientConfigSchema>;
