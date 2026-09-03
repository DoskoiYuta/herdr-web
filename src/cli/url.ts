import { homedir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { ConfigSchema } from "../contract/config";

const DEFAULT_URL = "http://127.0.0.1:8080";

/**
 * hw CLI が接続する herdr-web サーバーの URL を決定する。
 * 優先順位: `HW_URL` 環境変数 > 設定ファイル (`~/.config/herdr-web/config.json`,
 * `HERDR_WEB_CONFIG_DIR` で変更可) の `host`/`port` > デフォルト (127.0.0.1:8080)。
 * 設定ファイルの読み込み・パース・スキーマ検証のいずれかが失敗した場合はデフォルトにフォールバックする。
 */
export async function resolveHwUrl(
  env: Record<string, string | undefined>,
  readFile: (path: string) => Promise<string>,
): Promise<string> {
  if (env.HW_URL) return env.HW_URL;

  const configDir = env.HERDR_WEB_CONFIG_DIR ?? join(homedir(), ".config", "herdr-web");
  const configPath = join(configDir, "config.json");

  let content: string;
  try {
    content = await readFile(configPath);
  } catch {
    return DEFAULT_URL;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return DEFAULT_URL;
  }

  const result = v.safeParse(ConfigSchema, parsedJson);
  if (!result.success) return DEFAULT_URL;

  return `http://${result.output.host}:${result.output.port}`;
}
