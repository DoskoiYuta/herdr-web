import { run, type ExecRunResult } from "../exec/run";

/** Thrown when `ps` or `lsof` itself is missing (`ENOENT`). Routes map this
 * to HTTP 501, distinct from a non-zero exit (503). */
export class ProcCommandNotFoundError extends Error {
  command: "ps" | "lsof";
  constructor(command: "ps" | "lsof") {
    super(`${command} command not found`);
    this.name = "ProcCommandNotFoundError";
    this.command = command;
  }
}

export type ProcRunResult = ExecRunResult;

export interface CreateProcRunnerOptions {
  /** Overridable for tests; production default is 5s. */
  timeoutMs?: number;
  /** Overridable for tests (fake `ps`/`lsof` scripts). */
  psBin?: string;
  lsofBin?: string;
}

export interface ProcRunner {
  /** `ps -axo pid=,ppid=,pcpu=,rss=,etime=,command=`. */
  ps(): Promise<ProcRunResult>;
  /** `lsof -n -d cwd -Fpn`. */
  lsofCwd(): Promise<ProcRunResult>;
  /** `lsof -nP -iTCP -sTCP:LISTEN -Fpn`. */
  lsofListen(): Promise<ProcRunResult>;
}

export function createProcRunner(options: CreateProcRunnerOptions = {}): ProcRunner {
  const { timeoutMs = 5000, psBin = "ps", lsofBin = "lsof" } = options;
  return {
    ps: () =>
      run(
        psBin,
        ["-axo", "pid=,ppid=,pcpu=,rss=,etime=,command="],
        timeoutMs,
        () => new ProcCommandNotFoundError("ps"),
      ),
    lsofCwd: () =>
      run(
        lsofBin,
        ["-n", "-d", "cwd", "-Fpn"],
        timeoutMs,
        () => new ProcCommandNotFoundError("lsof"),
      ),
    lsofListen: () =>
      run(
        lsofBin,
        ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"],
        timeoutMs,
        () => new ProcCommandNotFoundError("lsof"),
      ),
  };
}
