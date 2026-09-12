import { describe, expect, test } from "bun:test";
import type { ConfigInput } from "../contract/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig } from "./config";

describe("parseConfig", () => {
  test("fills defaults for an empty object", () => {
    const { config, problem } = parseConfig({});
    expect(problem).toBeNull();
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.notify.debounceMs).toBe(10_000);
    expect(config.notify.template).toContain("{count}");
  });

  test("reports the failing path and falls back to defaults", () => {
    const { config, problem } = parseConfig({ port: "abc", notify: { debounceMs: -1 } });
    expect(problem).toContain("port");
    expect(config.port).toBe(8080);
  });

  test("defaults ask.agents and ask.defaultAgent", () => {
    const { config } = parseConfig({});
    expect(config.ask.agents).toEqual(["claude", "codex", "gemini"]);
    expect(config.ask.defaultAgent).toBe("claude");
  });

  // 無いと壊れる: defaultAgent が agents に無いまま使うと、AskSessionLauncher に
  // 存在しないエージェント種別が渡って起動が失敗し続ける。
  test("rounds ask.defaultAgent to agents[0] and reports it when defaultAgent isn't in agents", () => {
    const { config, problem } = parseConfig({
      ask: { agents: ["codex", "gemini"], defaultAgent: "claude" },
    });
    expect(config.ask.defaultAgent).toBe("codex");
    expect(problem).toContain("defaultAgent");
  });

  // 無いと壊れる: agents が [] のまま丸めずに使うと、defaultAgent がどんな値でも
  // agents に含まれ得ず、新規セッションの質問が常に unknown_agent になる。
  test.each([
    [{ ask: { agents: [] } } satisfies ConfigInput, ["claude", "codex", "gemini"], "claude"],
    [{ ask: { agents: ["claude", "claude"] } } satisfies ConfigInput, ["claude"], "claude"],
    [{ ask: { agents: ["", "codex"] } } satisfies ConfigInput, ["codex"], "codex"],
    [{ ask: { agents: ["codex", "gemini"] } } satisfies ConfigInput, ["codex", "gemini"], "codex"],
  ])("normalizes ask.agents/defaultAgent for %j", (input, expectedAgents, expectedDefault) => {
    const { config } = parseConfig(input);
    expect(config.ask.agents).toEqual(expectedAgents);
    expect(config.ask.defaultAgent).toBe(expectedDefault);
  });

  test("reports a problem when ask.agents is empty and falls back to the default list", () => {
    const { problem } = parseConfig({ ask: { agents: [] } });
    expect(problem).toContain("ask.agents");
  });

  // 無いと壊れる: 不正な keybind をそのまま配信すると、ブラウザ側の
  // parseKeybind が黙って無視するだけで起動時に何も気づけない。また
  // modifier 無しの 1 文字（例 "a"）を通すと通常入力を潰してしまう。
  test("drops unparsable keybind keys, empty values, and unmodified single-char keys", () => {
    const { config, problem } = parseConfig({
      terminal: {
        keybinds: {
          "shift+left": "\x1bb",
          "shfit+left": "\x1bx",
          "shift+right": "",
          a: "x",
          escape: "\x1b",
        },
      },
    });
    expect(config.terminal.keybinds).toEqual({ "shift+left": "\x1bb", escape: "\x1b" });
    expect(problem).not.toBeNull();
  });
});

describe("loadConfig", () => {
  test("missing file → defaults, no problem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hw-config-"));
    const r = await loadConfig(join(dir, "config.json"));
    expect(r.problem).toBeNull();
    expect(r.config.port).toBe(8080);
  });

  test("invalid JSON → defaults with problem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hw-config-"));
    const p = join(dir, "config.json");
    await writeFile(p, "{ not json");
    const r = await loadConfig(p);
    expect(r.problem).toContain("JSON parse error");
    expect(r.config.port).toBe(8080);
  });

  test("valid file overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hw-config-"));
    const p = join(dir, "config.json");
    await writeFile(p, JSON.stringify({ port: 9000, herdrSession: "work" }));
    const r = await loadConfig(p);
    expect(r.problem).toBeNull();
    expect(r.config.port).toBe(9000);
    expect(r.config.herdrSession).toBe("work");
  });
});
