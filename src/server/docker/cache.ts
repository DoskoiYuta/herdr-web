import { createSingleFlightCache, type SingleFlightCache } from "../cache/singleFlight";
import type { DockerRunResult, DockerRunner } from "./runner";

export interface CreateDockerCacheOptions {
  runner: DockerRunner;
  /** Overridable for tests. */
  now?: () => number;
  ttlMs?: number;
}

/** `docker ps` is root-independent, so one cache entry serves every root —
 * concurrent requests across browsers/tabs share a single in-flight run,
 * and a repeat within `ttlMs` reuses its result. */
export type DockerCache = SingleFlightCache<DockerRunResult>;

export function createDockerCache(options: CreateDockerCacheOptions): DockerCache {
  const { runner, ...cacheOptions } = options;
  return createSingleFlightCache(() => runner.ps(), cacheOptions);
}
