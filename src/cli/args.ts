/**
 * Small hand-written argv parser for the `hw` CLI (plan §7 F6). No external
 * dependency: subcommands pass a spec of known `--boolean` and `--string`
 * (value-taking) flag names; anything else starting with `--` is a usage
 * error. `--` stops flag parsing — everything after it (including things
 * that look like flags) becomes a positional, which lets `hw review reply`
 * accept reply text starting with `-`.
 */

export type FlagSpec = {
  /** Flags that take no value, e.g. "all" for `--all`. */
  boolean?: string[];
  /** Flags that require a following value, e.g. "commit" for `--commit <rev>`. */
  string?: string[];
};

export type ParsedArgs = {
  flags: Record<string, string | boolean>;
  positionals: string[];
};

export type ParseResult = { ok: true; value: ParsedArgs } | { ok: false; error: string };

export function parseArgs(argv: string[], spec: FlagSpec): ParseResult {
  const boolSet = new Set(spec.boolean ?? []);
  const stringSet = new Set(spec.string ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  let sawDashDash = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (!sawDashDash && arg === "--") {
      sawDashDash = true;
      continue;
    }

    if (!sawDashDash && arg.startsWith("--") && arg.length > 2) {
      const name = arg.slice(2);
      if (boolSet.has(name)) {
        flags[name] = true;
        continue;
      }
      if (stringSet.has(name)) {
        const value = argv[i + 1];
        if (value === undefined) {
          return { ok: false, error: `--${name} requires a value` };
        }
        flags[name] = value;
        i++;
        continue;
      }
      return { ok: false, error: `unknown flag: --${name}` };
    }

    positionals.push(arg);
  }

  return { ok: true, value: { flags, positionals } };
}

export function flagString(flags: Record<string, string | boolean>, name: string): string | null {
  const v = flags[name];
  return typeof v === "string" ? v : null;
}

export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}
