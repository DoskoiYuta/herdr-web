import { homedir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { type Config, ConfigSchema } from "../contract/config";

export type LoadedConfig = {
  config: Config;
  path: string;
  /** 読み込みに失敗した理由。null なら正常。既定値で続行する（plan N8）。 */
  problem: string | null;
};

export function configDir(): string {
  return process.env.HERDR_WEB_CONFIG_DIR ?? join(homedir(), ".config", "herdr-web");
}

export function defaultConfigPath(): string {
  return join(configDir(), "config.json");
}

export function parseConfig(raw: unknown): { config: Config; problem: string | null } {
  const r = v.safeParse(ConfigSchema, raw);
  if (r.success) return { config: r.output, problem: null };
  const msg = r.issues.map((i) => `${v.getDotPath(i) ?? "(root)"}: ${i.message}`).join("; ");
  return { config: v.parse(ConfigSchema, {}), problem: msg };
}

export async function loadConfig(path = defaultConfigPath()): Promise<LoadedConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { config: v.parse(ConfigSchema, {}), path, problem: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    return { config: v.parse(ConfigSchema, {}), path, problem: `JSON parse error: ${String(e)}` };
  }
  return { ...parseConfig(raw), path };
}

export function resolveDbPath(config: Config): string {
  return config.dbPath ?? join(configDir(), "herdr-web.db");
}

export function applyEnvOverrides(config: Config): Config {
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;
  return {
    ...config,
    ...(port && Number.isInteger(port) ? { port } : {}),
    ...(process.env.HOST ? { host: process.env.HOST } : {}),
  };
}
