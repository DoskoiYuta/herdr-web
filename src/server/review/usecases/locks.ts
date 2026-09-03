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
};

export function createLocks(): Locks {
  const chains = new Map<string, Promise<unknown>>();

  return {
    withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prior = chains.get(key) ?? Promise.resolve();
      const result = prior.then(fn, fn);
      // Keep the chain alive even if `fn` rejected, but never let a rejection
      // propagate into the chain itself (that would wedge every later caller).
      chains.set(
        key,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
  };
}
