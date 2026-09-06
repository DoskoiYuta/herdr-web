import { execFile } from "node:child_process";

export interface ExecRunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs `bin args…`, capping output at 64MiB and killing with SIGKILL on
 * `timeoutMs`. Never rejects on a non-zero exit (callers read `code`) —
 * rejects only via `onNotFound()` when the binary itself is missing
 * (`ENOENT`). `timedOut` is true only when `execFile` itself killed the
 * process for exceeding `timeoutMs` (`error.killed`); a process that dies
 * from an unrelated signal reports a non-zero `code` instead, since nothing
 * indicates *why* it died. */
export function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  onNotFound: () => Error,
): Promise<ExecRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
          return;
        }
        const errAny = error as NodeJS.ErrnoException & { killed?: boolean };
        if (errAny.code === "ENOENT") {
          reject(onNotFound());
          return;
        }
        if (typeof errAny.code === "number") {
          resolve({ code: errAny.code, stdout, stderr, timedOut: false });
          return;
        }
        resolve({ code: -1, stdout, stderr, timedOut: !!errAny.killed });
      },
    );
  });
}
