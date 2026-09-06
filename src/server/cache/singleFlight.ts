export interface CreateSingleFlightCacheOptions {
  /** Overridable for tests. */
  now?: () => number;
  ttlMs?: number;
}

export interface SingleFlightCache<T> {
  /** Concurrent calls within the same in-flight run share one `fn()` call;
   * a repeat after it settles reuses the result until `ttlMs` elapses. */
  get(): Promise<T>;
}

export function createSingleFlightCache<T>(
  fn: () => Promise<T>,
  options: CreateSingleFlightCacheOptions = {},
): SingleFlightCache<T> {
  const { now = Date.now, ttlMs = 2000 } = options;
  let cached: { at: number; promise: Promise<T> } | null = null;

  return {
    get(): Promise<T> {
      const nowMs = now();
      if (cached && nowMs - cached.at < ttlMs) return cached.promise;

      const promise = fn();
      cached = { at: nowMs, promise };
      promise.catch(() => {
        // A failed run must not poison the cache for the rest of the TTL —
        // the next call should retry rather than replay the same
        // rejection. Guarded by identity so a failure from a *stale*
        // promise (already superseded by a newer get()) doesn't clear the
        // entry that superseded it.
        if (cached?.promise === promise) cached = null;
      });
      return promise;
    },
  };
}
