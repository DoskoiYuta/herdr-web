import type { Timer, TimerHandle } from "../ports";

/**
 * F4: an in-process, per-key async mutex. Callers `withLock(key, fn)` and `fn`
 * is guaranteed to run only after every previously-queued `fn` for the same
 * `key` has settled (FIFO). Used to serialize read-modify-write cycles on the
 * same review (`review:<id>`) and on the same worktree root's reanchor pass
 * (`root:<root>`), so a reply can never race a concurrent reanchor and lose
 * one side's update.
 */
export type Locks = {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** F11: number of keys with a live (not yet fully drained) chain. For diagnostics/tests. */
  size(): number;
};

export type CreateLocksOptions = {
  logger?: Pick<typeof console, "warn">;
  /** Injectable timer for the "holder ran too long" watchdog. Defaults to real timers. */
  timer?: Timer;
  /** How long a single `fn` may hold a key before a warning is logged. Default 30s. */
  warnAfterMs?: number;
};

const realTimer: Timer = {
  setTimeout(cb, ms) {
    const t = setTimeout(cb, ms);
    return { id: Number(t) };
  },
  clearTimeout(handle) {
    clearTimeout(handle.id);
  },
};

export function createLocks(options: CreateLocksOptions = {}): Locks {
  const chains = new Map<string, Promise<unknown>>();
  const logger = options.logger ?? console;
  const timer = options.timer ?? realTimer;
  const warnAfterMs = options.warnAfterMs ?? 30_000;

  return {
    withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prior = chains.get(key) ?? Promise.resolve();

      // Run `fn` once `prior` settles either way — a rejection in a previous
      // holder must never wedge later callers on the same key.
      const run = (async (): Promise<T> => {
        await prior.then(
          () => undefined,
          () => undefined,
        );
        // F11: the watchdog starts once `fn` actually becomes the holder (not
        // while it's still queued behind a prior holder), and is always
        // cleared when `fn` settles so a fast holder never logs late.
        const handle: TimerHandle = timer.setTimeout(() => {
          logger.warn(`lock held > ${warnAfterMs}ms for key=${key}`);
        }, warnAfterMs);
        try {
          return await fn();
        } finally {
          timer.clearTimeout(handle);
        }
      })();

      // Keep the chain alive even if `fn` rejected, but never let a rejection
      // propagate into the chain itself (that would wedge every later caller).
      const settled: Promise<unknown> = run.then(
        () => undefined,
        () => undefined,
      );
      chains.set(key, settled);

      // F11: drop the map entry once this call's link has settled — but only
      // if nothing newer has been queued for `key` since (i.e. `settled` is
      // still the tail of the chain). `.finally` runs before the returned
      // promise settles, so callers awaiting `run` observe the cleanup.
      return run.finally(() => {
        if (chains.get(key) === settled) {
          chains.delete(key);
        }
      });
    },

    size(): number {
      return chains.size;
    },
  };
}
