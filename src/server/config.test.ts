import { describe, expect, test } from "bun:test";
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
