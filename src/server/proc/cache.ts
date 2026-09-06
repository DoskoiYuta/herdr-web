import { createSingleFlightCache, type SingleFlightCache } from "../cache/singleFlight";
import type { ProcRunner, ProcRunResult } from "./runner";

export interface ProcSnapshot {
  ps: ProcRunResult;
  lsofCwd: ProcRunResult;
  lsofListen: ProcRunResult;
}

export interface CreateProcCacheOptions {
  runner: ProcRunner;
  /** Overridable for tests. */
  now?: () => number;
  ttlMs?: number;
}

/** The scan is root-independent (every process is walked once, filtered to
 * a root by the route), so one cache entry serves every root — concurrent
 * requests across browsers/tabs share a single in-flight scan. */
export type ProcCache = SingleFlightCache<ProcSnapshot>;

export function createProcCache(options: CreateProcCacheOptions): ProcCache {
  const { runner, ...cacheOptions } = options;
  return createSingleFlightCache(
    () =>
      Promise.all([runner.ps(), runner.lsofCwd(), runner.lsofListen()]).then(
        ([ps, lsofCwd, lsofListen]) => ({ ps, lsofCwd, lsofListen }),
      ),
    cacheOptions,
  );
}
