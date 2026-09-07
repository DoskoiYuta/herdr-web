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

const DEFAULT_ASK_AGENTS = ["claude", "codex", "gemini"];

/** `ask.agents` の空文字除去・重複除去。結果が空になったら既定一覧に戻す
 * （`agents: []` を丸めずに使うと `defaultAgent` がどんな値でも `agents` に
 * 含まれず、新規セッションの質問が常に `unknown_agent` になる）。 */
function normalizeAskAgents(agents: string[]): { agents: string[]; problem: string | null } {
  const cleaned = [...new Set(agents.filter((a) => a.length > 0))];
  if (cleaned.length > 0) return { agents: cleaned, problem: null };
  return {
    agents: DEFAULT_ASK_AGENTS,
    problem: `ask.agents が空のため既定値 ${JSON.stringify(DEFAULT_ASK_AGENTS)} を使います`,
  };
}

/** `ask.agents` を正規化し、`ask.defaultAgent` がその中に無ければ先頭へ丸める。
 * herdr は `agent.start` の `kind` を検証しないので、ここで丸めないと存在しない
 * エージェント種別がそのまま渡ってしまう。 */
function normalizeAsk(config: Config): { config: Config; problem: string | null } {
  const agentsResult = normalizeAskAgents(config.ask.agents);
  const problems: string[] = [];
  if (agentsResult.problem) problems.push(agentsResult.problem);

  let ask = { ...config.ask, agents: agentsResult.agents };
  if (!ask.agents.includes(ask.defaultAgent)) {
    const rounded = ask.agents[0]!;
    problems.push(
      `ask.defaultAgent: "${ask.defaultAgent}" は ask.agents に無いため "${rounded}" を使います`,
    );
    ask = { ...ask, defaultAgent: rounded };
  }

  return {
    config: { ...config, ask },
    problem: problems.length > 0 ? problems.join("; ") : null,
  };
}

export function parseConfig(raw: unknown): { config: Config; problem: string | null } {
  const r = v.safeParse(ConfigSchema, raw);
  if (!r.success) {
    const msg = r.issues.map((i) => `${v.getDotPath(i) ?? "(root)"}: ${i.message}`).join("; ");
    return { config: v.parse(ConfigSchema, {}), problem: msg };
  }
  return normalizeAsk(r.output);
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
