import { spawn as spawnPty } from "bun-pty";
import type { IExitEvent, IPty } from "bun-pty";

export type SpawnHerdrOptions = {
  /** herdr の --session に渡すセッション名。省略時は付けない */
  session?: string;
  cols: number;
  rows: number;
  cwd?: string;
  /** テスト用に herdr 以外のバイナリを起動する */
  bin?: string;
  /** テスト用にコマンドライン引数を丸ごと差し替える（session 由来の args より優先） */
  argv?: string[];
};

export type SpawnedTerminal = {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (event: IExitEvent) => void): void;
};

function buildEnvPairs(): string[] {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("HERDR_")) continue;
    env[key] = value;
  }
  env.TERM = "xterm-256color";
  if (process.env.COLORTERM) env.COLORTERM = process.env.COLORTERM;
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function buildArgs(opts: SpawnHerdrOptions): string[] {
  if (opts.argv) return opts.argv;
  return opts.session ? ["--session", opts.session] : [];
}

export function spawnHerdr(opts: SpawnHerdrOptions): SpawnedTerminal {
  const bin = opts.bin ?? "herdr";
  const args = buildArgs(opts);

  // bun-pty (portable-pty 経由) は spawn に渡した env オプションを
  // 呼び出し側プロセスの環境へ追加マージするだけで、キーの削除・置換は
  // 反映しない（bun-pty 0.4 系の既知の制約）。process.env を書き換えても
  // 同様に無視される。そのため直接 herdr を起動する代わりに
  // `env -i <KEY=VALUE>... herdr ...` でラップし、`env` コマンド自身に
  // 完全にクリーンな環境を execve させることで HERDR_* を確実に落とす。
  const pty: IPty = spawnPty("/usr/bin/env", ["-i", ...buildEnvPairs(), bin, ...args], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    write(data) {
      pty.write(typeof data === "string" ? data : decoder.decode(data));
    },
    resize(cols, rows) {
      pty.resize(cols, rows);
    },
    kill() {
      pty.kill();
    },
    onData(cb) {
      pty.onData((data) => cb(encoder.encode(data)));
    },
    onExit(cb) {
      pty.onExit(cb);
    },
  };
}
