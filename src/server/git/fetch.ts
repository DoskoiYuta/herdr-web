import { execFile } from "node:child_process";

/**
 * Thrown by `fetch` when another fetch is already running for the same
 * `root`. Routes map this to HTTP 409.
 */
export class FetchBusyError extends Error {
  readonly root: string;

  constructor(root: string) {
    super(`herdr-web: a fetch is already running for ${root}`);
    this.name = "FetchBusyError";
    this.root = root;
  }
}

export interface FetchResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CreateFetchRunnerOptions {
  /** Overridable for tests; production default is 120s. */
  timeoutMs?: number;
  /** Overridable for tests (a fake `git` script). */
  bin?: string;
}

export interface FetchRunner {
  /** Runs `git fetch --prune` in `root`. Never throws on a non-zero exit —
   * that comes back on the result. Rejects with `FetchBusyError` if a fetch
   * is already in flight for `root`. */
  fetch(root: string): Promise<FetchResult>;
  isBusy(root: string): boolean;
}

/**
 * Runs `git fetch --prune`, one at a time per `root` (a second `fetch` call
 * for a busy `root` rejects with `FetchBusyError`; other roots run
 * concurrently). `GIT_TERMINAL_PROMPT=0` makes it fail fast instead of
 * hanging on a credential prompt; `GIT_SSH_COMMAND` is left untouched so
 * ssh-agent/credential-helper auth still works. A timeout (120s by default)
 * SIGKILLs the child and resolves with `code: -1, timedOut: true` — this
 * never throws for a non-zero exit or a timeout.
 */
export function createFetchRunner(options: CreateFetchRunnerOptions = {}): FetchRunner {
  const { timeoutMs = 120000, bin = "git" } = options;
  const busyRoots = new Set<string>();

  function execFetch(root: string): Promise<FetchResult> {
    const start = Date.now();
    return new Promise<FetchResult>((resolve) => {
      execFile(
        bin,
        ["fetch", "--prune"],
        {
          cwd: root,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 256 * 1024 * 1024,
          encoding: "utf8",
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" },
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - start;
          if (!error) {
            resolve({ code: 0, stdout, stderr, durationMs, timedOut: false });
            return;
          }
          const errAny = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals | null;
          };
          if (typeof errAny.code === "number") {
            resolve({ code: errAny.code, stdout, stderr, durationMs, timedOut: false });
            return;
          }
          // Spawn failure, timeout, or any other signal kill: no numeric
          // exit code. Timeout/kill is reported distinctly via `timedOut`.
          const timedOut = !!errAny.killed || !!errAny.signal;
          resolve({ code: -1, stdout, stderr, durationMs, timedOut });
        },
      );
    });
  }

  return {
    async fetch(root: string): Promise<FetchResult> {
      if (busyRoots.has(root)) {
        throw new FetchBusyError(root);
      }
      busyRoots.add(root);
      try {
        return await execFetch(root);
      } finally {
        busyRoots.delete(root);
      }
    },
    isBusy(root: string): boolean {
      return busyRoots.has(root);
    },
  };
}
