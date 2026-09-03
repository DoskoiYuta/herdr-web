import { execFile } from "node:child_process";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const HASH_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

// Shared config flags for the two diff-producing entry points (diffPatch,
// noIndexPatch), so the patch format is pinned against the user's global
// git config (e.g. diff.noprefix, diff.mnemonicPrefix).
const DIFF_CONFIG_ARGS = [
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.relative=false",
  "-c",
  "diff.submodule=short",
];

interface RunGitOptionsBase {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  okCodes?: number[];
  maxBuffer?: number;
  timeout?: number;
  killSignal?: NodeJS.Signals;
  bin?: string;
  input?: string | Buffer;
}

/** `encoding` omitted or a text encoding: `stdout` comes back as `string`. */
export interface RunGitOptions extends RunGitOptionsBase {
  encoding?: BufferEncoding;
}

/** `encoding: 'buffer'`: `stdout` comes back as a raw `Buffer`. */
export interface RunGitBufferOptions extends RunGitOptionsBase {
  encoding: "buffer";
}

export interface RunGitResult {
  stdout: string;
  code: number;
}

export interface RunGitBufferResult {
  stdout: Buffer;
  code: number;
}

/**
 * Run `git -c core.quotePath=false <args>` and resolve `{ stdout, code }`.
 * Rejects with an Error (message includes error.code/signal/killed and the
 * first stderr line) whenever `error` is set and its `code` is not a number
 * present in `okCodes` (e.g. spawn failures, timeouts, signals).
 *
 * Overloaded on `options.encoding` so callers get a properly narrowed
 * `stdout: string` vs `stdout: Buffer` without a cast at the call site;
 * `'buffer'` is the only encoding that switches the result shape.
 */
export function runGit(args: string[], options?: RunGitOptions): Promise<RunGitResult>;
export function runGit(args: string[], options: RunGitBufferOptions): Promise<RunGitBufferResult>;
export function runGit(
  args: string[],
  options: RunGitOptions | RunGitBufferOptions = {},
): Promise<RunGitResult | RunGitBufferResult> {
  const {
    cwd,
    env,
    okCodes = [0],
    maxBuffer = 256 * 1024 * 1024,
    encoding = "utf8",
    timeout = 30000,
    killSignal = "SIGKILL",
    bin = "git",
    input,
  } = options;

  const fullArgs = ["-c", "core.quotePath=false", ...args];

  return new Promise((resolve, reject) => {
    // Force the C locale so git's own messages are not localized —
    // catFileBlob's "does this blob exist" check depends on matching
    // specific English error text. LC_ALL wins over LANG/other LC_* vars
    // in glibc/gettext resolution, so setting it last (after any
    // caller-supplied opts.env) is enough on its own; LANG is set too for
    // completion/consistency in tooling that only inspects LANG.
    const execOptions = {
      cwd,
      maxBuffer,
      encoding,
      timeout,
      killSignal,
      env: { ...process.env, ...env, LC_ALL: "C", LANG: "C" },
    };

    // execFile's ~10 overloads pick string vs Buffer stdout/stderr based on
    // `encoding`, which we only know at runtime (it's a caller-supplied
    // option). One `any` here lets us handle both shapes uniformly; the
    // callback re-derives the real type per-call via `Buffer.isBuffer`.
    const execFileAny = execFile as unknown as (
      bin: string,
      args: string[],
      options: unknown,
      callback: (
        error: (Error & { code?: unknown; signal?: unknown; killed?: unknown }) | null,
        stdout: string | Buffer,
        stderr: string | Buffer,
      ) => void,
    ) => { stdin: NodeJS.WritableStream | null };

    const child = execFileAny(bin, fullArgs, execOptions, (error, stdout, stderr) => {
      if (error && !(typeof error.code === "number" && okCodes.includes(error.code))) {
        const stderrText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr;
        const firstStderrLine = (stderrText && stderrText.trim().split("\n")[0]) || "";
        const details = `code=${error.code ?? "null"} signal=${error.signal ?? "null"} killed=${!!error.killed}`;
        const reason = firstStderrLine || error.message;
        reject(new Error(`git ${args.join(" ")}: ${reason} (${details})`));
        return;
      }
      const code = error && typeof error.code === "number" ? error.code : 0;
      resolve({ stdout, code } as RunGitResult | RunGitBufferResult);
    });

    if (input !== undefined) {
      child.stdin?.on("error", () => {
        // ignore EPIPE etc.; the exit handler above reports the real failure
      });
      child.stdin?.write(input);
      child.stdin?.end();
    }
  });
}

export async function getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

export async function hasHead(cwd: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "-q", "HEAD"], { cwd, okCodes: [0] });
    return true;
  } catch {
    return false;
  }
}

const emptyTreeCache = new Map<string, string>();

/**
 * The hash of the empty tree, in whichever object format `cwd`'s repo uses
 * (sha1 or sha256). Computed once via `git hash-object -t tree /dev/null`
 * and cached per repo root.
 */
export async function getEmptyTree(cwd: string): Promise<string> {
  const cached = emptyTreeCache.get(cwd);
  if (cached !== undefined) return cached;
  const { stdout } = await runGit(["hash-object", "-t", "tree", "/dev/null"], { cwd });
  const hash = stdout.trim();
  emptyTreeCache.set(cwd, hash);
  return hash;
}

export async function catFileBlob(root: string, hash: string): Promise<Buffer | null> {
  if (!HASH_RE.test(hash)) {
    throw new Error(`invalid blob hash: ${hash}`);
  }
  try {
    const { stdout } = await runGit(["cat-file", "blob", hash], {
      cwd: root,
      okCodes: [0],
      encoding: "buffer",
    });
    return stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /Not a valid object name/i.test(msg) ||
      /does not exist/i.test(msg) ||
      /bad file/i.test(msg)
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * `dir` is the directory to run git from (the caller's cwd, so relative
 * pathspecs resolve as written). `--full-name` makes the returned paths
 * repo-root-relative regardless of `dir`.
 */
export async function listUntracked(dir: string, pathspec: string[] = []): Promise<string[]> {
  const args = ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"];
  if (pathspec.length > 0) {
    args.push("--", ...pathspec);
  }
  const { stdout } = await runGit(args, { cwd: dir });
  return stdout
    .split("\0")
    .filter((s) => s.length > 0)
    .sort();
}

export async function noIndexPatch(root: string, path: string): Promise<string> {
  const { stdout } = await runGit(
    [
      ...DIFF_CONFIG_ARGS,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--full-index",
      "--no-index",
      "--",
      "/dev/null",
      path,
    ],
    { cwd: root, okCodes: [0, 1] },
  );
  return stdout;
}

export async function diffPatch(cwd: string, gitArgs: string[]): Promise<string> {
  const { stdout } = await runGit(
    [
      ...DIFF_CONFIG_ARGS,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--full-index",
      ...gitArgs,
    ],
    { cwd },
  );
  return stdout;
}
