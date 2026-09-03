import { createHash } from "node:crypto";
import { runGit } from "./run";

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

interface Snapshot {
  status: string;
  refs: string;
  head: string;
}

async function snapshot(root: string): Promise<Snapshot> {
  const [status, refs, head] = await Promise.all([
    runGit(["status", "--porcelain=v2", "-z"], { cwd: root }),
    runGit(["for-each-ref"], { cwd: root }),
    runGit(["rev-parse", "HEAD"], { cwd: root, okCodes: [0, 128] }),
  ]);
  return { status: hash(status.stdout), refs: hash(refs.stdout), head: hash(head.stdout) };
}

async function currentHead(root: string): Promise<string | null> {
  try {
    const { stdout, code } = await runGit(["rev-parse", "HEAD"], { cwd: root, okCodes: [0, 128] });
    if (code !== 0) return null;
    const head = stdout.trim();
    return head.length === 0 ? null : head;
  } catch {
    return null;
  }
}

export type ChangedReason = "status" | "refs" | "head";

export interface ChangedInfo {
  root: string;
  reason: ChangedReason;
  head: string | null;
}

/** F6: classifies a poller failure so callers can tell "the worktree root is gone" from anything else. */
export type PollerErrorKind = "missing" | "other";

function classifyPollerError(message: string): PollerErrorKind {
  if (/ENOENT/i.test(message) || /not a git repository/i.test(message)) return "missing";
  return "other";
}

export interface CreateWorktreePollerOptions {
  root: string;
  intervalMs?: number;
  onChanged?: (info: ChangedInfo) => void;
  onStatus?: (info: { error: string | null; kind?: PollerErrorKind }) => void;
}

export interface WorktreePoller {
  start(): Promise<void>;
  stop(): void;
}

/**
 * Polls one worktree root every `intervalMs` (default 1000) for status /
 * ref / HEAD changes. Ticks are serialized: a tick already in flight is
 * never overlapped by the next scheduled one.
 */
export function createWorktreePoller({
  root,
  intervalMs = 1000,
  onChanged,
  onStatus,
}: CreateWorktreePollerOptions): WorktreePoller {
  let prev: Snapshot | null = null;
  let error: string | null = null;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const snap = await snapshot(root);
      if (error !== null) {
        error = null;
        onStatus?.({ error: null });
      }
      if (prev) {
        const head = await currentHead(root);
        if (prev.refs !== snap.refs) {
          onChanged?.({ root, reason: "refs", head });
        } else if (prev.head !== snap.head) {
          onChanged?.({ root, reason: "head", head });
        }
        if (prev.status !== snap.status) {
          onChanged?.({ root, reason: "status", head });
        }
      }
      prev = snap;
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err).split("\n")[0] ?? "";
      if (message !== error) {
        error = message;
        onStatus?.({ error: message, kind: classifyPollerError(message) });
      }
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, intervalMs);
    timer.unref?.();
  }

  return {
    async start() {
      stopped = false;
      await tick();
      scheduleNext();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export interface PollerRegistryOptions {
  intervalMs?: number;
  onChanged?: (info: ChangedInfo) => void;
  onStatus?: (info: { root: string; error: string | null; kind?: PollerErrorKind }) => void;
}

export interface PollerRegistry {
  /** Starts polling `root` if not already watched; always bumps its refcount. */
  watch(root: string): void;
  /** Drops one reference to `root`; stops and removes its poller at refcount 0. */
  unwatch(root: string): void;
  /** How many outstanding `watch(root)` calls have not been `unwatch`'d. */
  refCount(root: string): number;
  /** Stops every poller and clears all refcounts. */
  stopAll(): void;
}

/**
 * Keeps at most one poller per worktree root, reference-counted so callers
 * (e.g. the events layer tracking which worktree is currently focused) can
 * `watch`/`unwatch` independently without starting duplicate pollers.
 */
export function createPollerRegistry({
  intervalMs,
  onChanged,
  onStatus,
}: PollerRegistryOptions = {}): PollerRegistry {
  const entries = new Map<string, { poller: WorktreePoller; refCount: number }>();

  return {
    watch(root: string) {
      const existing = entries.get(root);
      if (existing) {
        existing.refCount++;
        return;
      }
      const poller = createWorktreePoller({
        root,
        intervalMs,
        onChanged: (info) => onChanged?.(info),
        onStatus: (info) => onStatus?.({ root, error: info.error, kind: info.kind }),
      });
      entries.set(root, { poller, refCount: 1 });
      void poller.start();
    },
    unwatch(root: string) {
      const existing = entries.get(root);
      if (!existing) return;
      existing.refCount--;
      if (existing.refCount <= 0) {
        existing.poller.stop();
        entries.delete(root);
      }
    },
    refCount(root: string) {
      return entries.get(root)?.refCount ?? 0;
    },
    stopAll() {
      for (const { poller } of entries.values()) poller.stop();
      entries.clear();
    },
  };
}
