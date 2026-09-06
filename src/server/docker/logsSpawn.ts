import { spawn } from "node:child_process";

export type DockerLogsExitEvent = { code: number | null; signal: NodeJS.Signals | null };

export interface DockerLogsProcess {
  onStdout(cb: (chunk: Buffer) => void): void;
  onStderr(cb: (chunk: Buffer) => void): void;
  onExit(cb: (event: DockerLogsExitEvent) => void): void;
  /** Fires when the process itself couldn't start (e.g. `docker` missing, ENOENT). */
  onError(cb: (err: NodeJS.ErrnoException) => void): void;
  kill(): void;
}

export interface SpawnDockerLogsOptions {
  id: string;
  tail: number;
  /** Overridable for tests. */
  bin?: string;
  /** Overridable for tests: replaces the built `docker logs` args entirely. */
  argv?: string[];
}

export type SpawnDockerLogs = (opts: SpawnDockerLogsOptions) => DockerLogsProcess;

export function spawnDockerLogs(opts: SpawnDockerLogsOptions): DockerLogsProcess {
  const bin = opts.bin ?? "docker";
  const args = opts.argv ?? [
    "logs",
    "--follow",
    "--tail",
    String(opts.tail),
    "--timestamps",
    opts.id,
  ];
  const child = spawn(bin, args);

  return {
    onStdout: (cb) => child.stdout.on("data", cb),
    onStderr: (cb) => child.stderr.on("data", cb),
    onExit: (cb) => child.on("exit", (code, signal) => cb({ code, signal })),
    onError: (cb) => child.on("error", cb as (err: Error) => void),
    kill: () => child.kill(),
  };
}
