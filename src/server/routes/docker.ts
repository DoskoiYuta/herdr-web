import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { DockerContainersQuerySchema, type DockerContainersResponse } from "../../contract/docker";
import { createDockerCache, type DockerCache } from "../docker/cache";
import { groupContainers, parseDockerPsOutput } from "../docker/parse";
import { createDockerRunner, DockerNotFoundError, type DockerRunner } from "../docker/runner";
import { resolveRoots } from "../docker/roots";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface DockerRoutesDeps {
  /** Absolute paths allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  /** `docker ps` runner; injected in tests. */
  runner?: DockerRunner;
  /** Overrides the runner-wrapping TTL/single-flight cache; injected in tests. */
  cache?: DockerCache;
}

export function dockerRoutes(deps: DockerRoutesDeps = {}) {
  const allowedRoots = deps.allowedRoots ?? [];
  const runner = deps.runner ?? createDockerRunner();
  const cache = deps.cache ?? createDockerCache({ runner });

  const app = new Hono().get(
    "/containers",
    vValidator("query", DockerContainersQuerySchema),
    async (c) => {
      const { root } = c.req.valid("query");

      if (!(await isAllowedRoot(root, allowedRoots))) {
        if (!(await pathExists(root))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      try {
        const result = await cache.get();
        if (result.timedOut) return c.json({ error: "timeout" as const }, 504);
        if (result.code !== 0) {
          return c.json({ error: "command-failed" as const, message: result.stderr }, 503);
        }
        const containers = parseDockerPsOutput(result.stdout);
        const roots = await resolveRoots(root);
        const body: DockerContainersResponse = { groups: groupContainers(containers, roots) };
        return c.json(body, 200);
      } catch (err) {
        if (err instanceof DockerNotFoundError) {
          return c.json({ error: "command-missing" as const }, 501);
        }
        return c.json(
          { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    },
  );

  return app;
}
