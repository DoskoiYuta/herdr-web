import { chmod, mkdir, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type HwShimMode = "dev" | "production";

export interface EnsureHwShimParams {
  /** herdr-web's config dir (e.g. `~/.config/herdr-web`); the shim goes in `<configDir>/bin`. */
  configDir: string;
  mode: HwShimMode;
  /** Overrides for tests: where `process.execPath` and the source `hw.ts` resolve to. */
  execPath?: string;
  logger?: Pick<typeof console, "warn">;
}

const HW_TS_PATH = fileURLToPath(new URL("../cli/hw.ts", import.meta.url));

function devScriptContent(hwTsPath: string): string {
  return `#!/bin/sh\nexec bun "${hwTsPath}" "$@"\n`;
}

/** Writes `content` to `path` only if it differs from what's already there (or nothing is there). */
async function writeIfDifferent(path: string, content: string): Promise<void> {
  const existing = await readFile(path, "utf8").catch(() => null);
  if (existing === content) return;
  await writeFile(path, content);
}

/**
 * Guarantees an executable `hw` exists in `<configDir>/bin` and returns that
 * directory, so ask-session can put it on PATH for the claude sessions herdr
 * spawns — otherwise those agents have no way to find `hw` and cannot reply
 * to the ask (§ask-session).
 *
 * Dev mode writes a shell script that execs `bun` against the repo's
 * `src/cli/hw.ts`. Production mode links (or copies, when linking fails) the
 * `hw` binary `build:bin` places next to the `herdr-web` binary
 * (`process.execPath`); if that sibling binary is missing, it logs a warning
 * once and still returns the bin dir so callers don't need to special-case it.
 */
export async function ensureHwShim(params: EnsureHwShimParams): Promise<string> {
  const logger = params.logger ?? console;
  const binDir = join(params.configDir, "bin");
  const hwPath = join(binDir, "hw");
  await mkdir(binDir, { recursive: true });

  if (params.mode === "dev") {
    await writeIfDifferent(hwPath, devScriptContent(HW_TS_PATH));
    await chmod(hwPath, 0o755);
    return binDir;
  }

  const execPath = params.execPath ?? process.execPath;
  const siblingBin = join(execPath.replace(/\/[^/]+$/, ""), "hw");
  const siblingExists = await Bun.file(siblingBin)
    .exists()
    .catch(() => false);

  if (!siblingExists) {
    logger.warn(
      `herdr-web: hw バイナリが ${siblingBin} に見つかりません。ask セッション内で \`hw\` は使えないため、` +
        '`bun run hw ask reply {id} "<本文>"` へのフォールバックを案内します。',
    );
    return binDir;
  }

  const currentTarget = await readlink(hwPath).catch(() => null);
  if (currentTarget !== siblingBin) {
    await unlink(hwPath).catch(() => {});
    try {
      await symlink(siblingBin, hwPath);
    } catch {
      await Bun.write(hwPath, Bun.file(siblingBin));
    }
    await chmod(hwPath, 0o755);
  }
  return binDir;
}
