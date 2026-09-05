import { execFile } from "node:child_process";

export type TrashResult =
  | { ok: true }
  | { ok: false; reason: "no-backend" }
  | { ok: false; reason: "failed"; message: string };

export interface TrashCandidate {
  /** Human-readable id, surfaced in nothing but test assertions. */
  name: string;
  /** True when this backend is installed/usable on this machine. */
  available(): Promise<boolean>;
  /** argv to run this backend against `real` (an absolute path). */
  argv(real: string): string[];
}

export interface TrashRunner {
  (argv: string[]): Promise<{ code: number; stderr: string }>;
}

async function commandExists(path: string): Promise<boolean> {
  return await Bun.file(path)
    .exists()
    .catch(() => false);
}

// Probed in order of preference: the dedicated `trash` CLI (macOS 14+,
// ships at a fixed path) actually uses the Finder trash, unlike `rm`;
// osascript's Finder AppleScript is the macOS fallback for older systems;
// `gio trash` / `trash-put` are the Linux desktop-environment equivalents.
// Never fall back further than this to `rm` — that would defeat the whole
// point of a "move to trash" action (no undo, no visible discard).
export const DEFAULT_TRASH_CANDIDATES: TrashCandidate[] = [
  {
    name: "macos-trash",
    available: () => commandExists("/usr/bin/trash"),
    argv: (real) => ["/usr/bin/trash", real],
  },
  {
    name: "macos-finder",
    available: () => Promise.resolve(process.platform === "darwin"),
    argv: (real) => ["osascript", "-e", `tell application "Finder" to delete POSIX file "${real}"`],
  },
  {
    name: "gio",
    available: async () => {
      if (process.platform !== "linux") return false;
      const { execFile: run } = await import("node:child_process");
      const { promisify } = await import("node:util");
      try {
        await promisify(run)("which", ["gio"]);
        return true;
      } catch {
        return false;
      }
    },
    argv: (real) => ["gio", "trash", real],
  },
  {
    name: "trash-put",
    available: async () => {
      const { execFile: run } = await import("node:child_process");
      const { promisify } = await import("node:util");
      try {
        await promisify(run)("which", ["trash-put"]);
        return true;
      } catch {
        return false;
      }
    },
    argv: (real) => ["trash-put", real],
  },
];

export function defaultTrashRunner(argv: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (!cmd) {
      resolve({ code: 1, stderr: "empty argv" });
      return;
    }
    execFile(cmd, args, (err, _stdout, stderr) => {
      const code = err && "code" in err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, stderr });
    });
  });
}

export interface Trasher {
  moveToTrash(real: string): Promise<TrashResult>;
}

/**
 * Builds a trasher that probes `candidates` once (cached for the process
 * lifetime — the set of installed backends doesn't change while running)
 * and runs the first available one via `run`.
 */
export function createTrasher(opts?: {
  candidates?: TrashCandidate[];
  run?: TrashRunner;
}): Trasher {
  const candidates = opts?.candidates ?? DEFAULT_TRASH_CANDIDATES;
  const run = opts?.run ?? defaultTrashRunner;
  let chosen: TrashCandidate | null | undefined; // undefined = not probed yet

  async function choose(): Promise<TrashCandidate | null> {
    if (chosen !== undefined) return chosen;
    for (const candidate of candidates) {
      if (await candidate.available()) {
        chosen = candidate;
        return chosen;
      }
    }
    chosen = null;
    return null;
  }

  return {
    async moveToTrash(real: string): Promise<TrashResult> {
      const candidate = await choose();
      if (!candidate) return { ok: false, reason: "no-backend" };
      const { code, stderr } = await run(candidate.argv(real));
      if (code !== 0) {
        const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "";
        return { ok: false, reason: "failed", message: firstLine };
      }
      return { ok: true };
    },
  };
}
