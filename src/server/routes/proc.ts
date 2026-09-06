import { realpath } from "node:fs/promises";
import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { ProcListQuerySchema, type ProcListResponse } from "../../contract/proc";
import { isAllowedRoot, pathExists } from "./allowed-roots";
import { createProcCache, type ProcCache, type ProcSnapshot } from "../proc/cache";
import { buildProcessList } from "../proc/parse";
import {
  createProcRunner,
  ProcCommandNotFoundError,
  type ProcRunner,
  type ProcRunResult,
} from "../proc/runner";

export interface ProcRoutesDeps {
  /** Absolute paths allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  /** `ps`/`lsof` runner; injected in tests. */
  runner?: ProcRunner;
  /** Overrides the runner-wrapping TTL/single-flight cache; injected in tests. */
  cache?: ProcCache;
}

/** `lsof` exits 1 with empty stdout/stderr when nothing matches its filter
 * (observed: no LISTEN sockets at all) — that's a successful empty result,
 * not a command failure. */
function isEmptySuccess(r: ProcRunResult): boolean {
  return r.code === 1 && !r.timedOut && r.stdout === "" && r.stderr === "";
}

function firstFailure(snapshot: ProcSnapshot) {
  return [snapshot.ps, snapshot.lsofCwd, snapshot.lsofListen].find(
    (r) => r.code !== 0 && !isEmptySuccess(r),
  );
}

function anyTimedOut(snapshot: ProcSnapshot): boolean {
  return [snapshot.ps, snapshot.lsofCwd, snapshot.lsofListen].some((r) => r.timedOut);
}

/** `lsof`'s cwd is a physical path (realpath) while a root can be given (or
 * symlinked) logically — resolve the root's realpath once per request so a
 * symlinked root still matches. Falls back to the raw root alone when
 * realpath fails (root already validated by `isAllowedRoot` above). */
async function resolveRoots(root: string): Promise<string[]> {
  try {
    const real = await realpath(root);
    return real === root ? [root] : [root, real];
  } catch {
    return [root];
  }
}

export function procRoutes(deps: ProcRoutesDeps = {}) {
  const allowedRoots = deps.allowedRoots ?? [];
  const runner = deps.runner ?? createProcRunner();
  const cache = deps.cache ?? createProcCache({ runner });

  const app = new Hono().get("/list", vValidator("query", ProcListQuerySchema), async (c) => {
    const { root } = c.req.valid("query");

    if (!(await isAllowedRoot(root, allowedRoots))) {
      if (!(await pathExists(root))) return c.json({ error: "not-found" as const }, 404);
      return c.json({ error: "forbidden" as const }, 403);
    }

    try {
      const snapshot = await cache.get();
      if (anyTimedOut(snapshot)) return c.json({ error: "timeout" as const }, 504);
      const failed = firstFailure(snapshot);
      if (failed) return c.json({ error: "command-failed" as const, message: failed.stderr }, 503);

      const roots = await resolveRoots(root);
      const body: ProcListResponse = {
        processes: buildProcessList(
          snapshot.ps.stdout,
          snapshot.lsofCwd.stdout,
          snapshot.lsofListen.stdout,
          roots,
        ),
      };
      return c.json(body, 200);
    } catch (err) {
      if (err instanceof ProcCommandNotFoundError) {
        return c.json({ error: "command-missing" as const, command: err.command }, 501);
      }
      return c.json(
        { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  return app;
}
