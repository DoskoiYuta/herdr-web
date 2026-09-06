import type { DockerCache } from "./cache";
import { groupContainers, parseDockerPsOutput } from "./parse";
import { DockerNotFoundError } from "./runner";

export type ContainerLookupResult =
  | { ok: true; found: boolean }
  | { ok: false; reason: "docker-unavailable" };

/** Answers "is `id` one of the containers tied to `roots`?" via the shared
 * `docker ps` cache — the same F11-2 classification used by
 * `GET /api/docker/containers`, reused so `/ws/docker-logs` can't be used to
 * read an arbitrary container's logs just because `root` checks out. */
export async function lookupContainer(opts: {
  cache: DockerCache;
  roots: string[];
  id: string;
}): Promise<ContainerLookupResult> {
  try {
    const result = await opts.cache.get();
    if (result.timedOut || result.code !== 0) return { ok: false, reason: "docker-unavailable" };
    const containers = parseDockerPsOutput(result.stdout);
    const groups = groupContainers(containers, opts.roots);
    const found = groups.some((group) => group.containers.some((c) => c.id === opts.id));
    return { ok: true, found };
  } catch (err) {
    if (err instanceof DockerNotFoundError) return { ok: false, reason: "docker-unavailable" };
    throw err;
  }
}
