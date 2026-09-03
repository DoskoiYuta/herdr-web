import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  CommitDetailQuerySchema,
  CommitParamSchema,
  FetchQuerySchema,
  type FetchResult,
  FilesQuerySchema,
  GraphQuerySchema,
  PatchQuerySchema,
  RootQuerySchema,
  type RootResponse,
  SubReposQuerySchema,
  type SubReposResponse,
} from "../../contract/git";
import { getCommitDetail } from "../git/detail";
import { createFetchRunner, FetchBusyError, type FetchRunner } from "../git/fetch";
import { resolveFiles } from "../git/files";
import { buildGraph } from "../git/graph";
import { InvalidComparisonError, generatePatch } from "../git/patch";
import { invalidateAll, resolveWorktree } from "../git/resolve";
import { listSubRepos } from "../git/subrepos";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface GitRoutesDeps {
  /** Absolute paths repos are allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  /** `git fetch --prune` runner backing POST /api/git/fetch. */
  fetchRunner?: FetchRunner;
}

const isAllowed = isAllowedRoot;
const exists = pathExists;

export function gitRoutes(deps: GitRoutesDeps = {}) {
  const allowedRoots = deps.allowedRoots ?? [];
  const fetchRunner = deps.fetchRunner ?? createFetchRunner();

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
    .get("/subrepos", vValidator("query", SubReposQuerySchema), async (c) => {
      const { repo } = c.req.valid("query");

      if (!(await isAllowed(repo, allowedRoots))) {
        if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      try {
        const repos = await listSubRepos(repo);
        const body: SubReposResponse = { repos };
        return c.json(body, 200);
      } catch (err) {
        return c.json(
          { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    })
    .post("/fetch", vValidator("query", FetchQuerySchema), async (c) => {
      const { repo } = c.req.valid("query");

      if (!(await isAllowed(repo, allowedRoots))) {
        if (!(await exists(repo))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      try {
        const result = await fetchRunner.fetch(repo);
        // The poller will notice the ref change on its own (`refs` reason)
        // for the focused worktree; this also drops the resolveWorktree
        // cache so branch/head reads reflect the fetch immediately.
        invalidateAll();
        const body: FetchResult = result;
        return c.json(body, 200);
      } catch (err) {
        if (err instanceof FetchBusyError) {
          return c.json({ error: "busy" as const }, 409);
        }
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
