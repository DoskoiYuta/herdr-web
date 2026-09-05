import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHwShim } from "./hw-shim";

async function tmpConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hw-shim-test-"));
}

describe("ensureHwShim", () => {
  test("dev mode writes an executable script that execs hw.ts", async () => {
    const configDir = await tmpConfigDir();
    const binDir = await ensureHwShim({ configDir, mode: "dev" });

    expect(binDir).toBe(join(configDir, "bin"));
    const content = await readFile(join(binDir, "hw"), "utf8");
    expect(content).toContain("src/cli/hw.ts");
    expect(content).toContain("exec bun");
    const mode = (await stat(join(binDir, "hw"))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  test("dev mode is idempotent: a second call doesn't rewrite unchanged content", async () => {
    const configDir = await tmpConfigDir();
    await ensureHwShim({ configDir, mode: "dev" });
    const hwPath = join(configDir, "bin", "hw");
    const before = await stat(hwPath);

    await new Promise((r) => setTimeout(r, 10));
    await ensureHwShim({ configDir, mode: "dev" });
    const after = await stat(hwPath);

    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  test("production mode links a sibling hw binary next to process.execPath", async () => {
    const configDir = await tmpConfigDir();
    const distDir = await mkdtemp(join(tmpdir(), "hw-shim-dist-"));
    const execPath = join(distDir, "herdr-web");
    await writeFile(join(distDir, "hw"), "#!/bin/sh\necho fake-hw\n");
    await chmod(join(distDir, "hw"), 0o755);

    const binDir = await ensureHwShim({ configDir, mode: "production", execPath });

    const target = await Bun.file(join(binDir, "hw")).text();
    expect(target).toContain("fake-hw");
  });

  test("production mode without a sibling binary warns once and still returns the bin dir", async () => {
    const configDir = await tmpConfigDir();
    const execPath = join(await mkdtemp(join(tmpdir(), "hw-shim-empty-")), "herdr-web");
    const warnings: unknown[][] = [];

    const binDir = await ensureHwShim({
      configDir,
      mode: "production",
      execPath,
      logger: { warn: (...args) => warnings.push(args) },
    });

    expect(binDir).toBe(join(configDir, "bin"));
    expect(warnings.length).toBe(1);
  });
});
