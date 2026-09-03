import { realpath as realpathAsync } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  CommitDetailQuerySchema,
  CommitParamSchema,
  FilesQuerySchema,
  GraphQuerySchema,
  PatchQuerySchema,
  RootQuerySchema,
  type RootResponse,
} from "../../contract/git";
import { getCommitDetail } from "../git/detail";
import { resolveFiles } from "../git/files";
import { buildGraph } from "../git/graph";
import { InvalidComparisonError, generatePatch } from "../git/patch";
import { resolveWorktree } from "../git/resolve";

export interface GitRoutesDeps {
  /** Absolute paths repos are allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
}

async function isAllowed(repo: string, allowedRoots: string[]): Promise<boolean> {
  let realRepo: string;
  try {
    realRepo = await realpathAsync(repo);
  } catch {
    return false;
  }
  const roots = [homedir(), ...allowedRoots];
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpathAsync(root);
    } catch {
      continue;
    }
    if (realRepo === realRoot || realRepo.startsWith(realRoot + sep)) return true;
  }
  return false;
}

/** True when `path` exists (via `realpath`) so a 403 can be distinguished from a plain 404. */
async function exists(path: string): Promise<boolean> {
  try {
    await realpathAsync(path);
    return true;
  } catch {
    return false;
  }
}

export function gitRoutes(deps: GitRoutesDeps = {}) {
  const allowedRoots = deps.allowedRoots ?? [];

  const app = new Hono()
    .get("/root", vValidator("query", RootQuerySchema), async (c) => {
      const { path } = c.req.valid("query");

      if (!(await isAllowed(path, allowedRoots))) {
        if (!(await exists(path))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const info = await resolveWorktree(path);
      if (!info) return c.json({ error: "not-found" as const }, 404);

      const body: RootResponse = info;
      return c.json(body, 200);
    })
    .get("/patch", vValidator("query", PatchQuerySchema), async (c) => {
      const { repo, from, to } = c.req.valid("query");

      if (!(await isAllowed(repo, allowedRoots))) {
        if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      try {
        const result = await generatePatch({ cwd: repo, root: repo, selector: { from, to } });
        return c.json(result, 200);
      } catch (err) {
        if (err instanceof InvalidComparisonError) {
          return c.json({ error: "invalid-comparison" as const, message: err.message }, 400);
        }
        return c.json(
          { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    })
    .get("/files", vValidator("query", FilesQuerySchema), async (c) => {
      const { repo, path, prev, type, oldHash, newHash } = c.req.valid("query");

      if (!(await isAllowed(repo, allowedRoots))) {
        if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const result = await resolveFiles({
        root: repo,
        path,
        prev: prev ?? null,
        type,
        oldHash: oldHash ?? null,
        newHash: newHash ?? null,
      });
      return c.json(result.body, result.status);
    })
    .get("/graph", vValidator("query", GraphQuerySchema), async (c) => {
      const { repo, max, all } = c.req.valid("query");

      if (!(await isAllowed(repo, allowedRoots))) {
        if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      const info = await resolveWorktree(repo);
      if (!info) return c.json({ error: "not-found" as const }, 404);

      try {
        const graph = await buildGraph({
          cwd: repo,
          repo,
          max: max !== undefined ? Number(max) : undefined,
          all: all === "true" || all === "1",
        });
        return c.json(graph, 200);
      } catch (err) {
        return c.json(
          { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    })
    .get(
      "/commit/:hash",
      vValidator("param", CommitParamSchema),
      vValidator("query", CommitDetailQuerySchema),
      async (c) => {
        const { hash } = c.req.valid("param");
        const { repo } = c.req.valid("query");

        if (!(await isAllowed(repo, allowedRoots))) {
          if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
          return c.json({ error: "forbidden" as const }, 403);
        }

        try {
          const detail = await getCommitDetail(repo, hash);
          return c.json(detail, 200);
        } catch {
          return c.json({ error: "not-found" as const }, 404);
        }
      },
    );

  return app;
}
