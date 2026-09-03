import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  WorkspaceCloseBodySchema,
  WorkspaceCreateBodySchema,
  WorkspaceIdParamSchema,
  WorkspaceRenameBodySchema,
  type WorkspaceCreateResponse,
} from "../../contract/herdr-ops";
import type { HerdrGateway } from "../herdr/gateway";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface HerdrRoutesDeps {
  gateway: HerdrGateway;
  /** Absolute paths a workspace's cwd is allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
}

/**
 * herdr-web's own workspace-management routes (sidebar create/rename/close),
 * distinct from `hw.ts` (the `hw` CLI's whoami lookup). `cwd` goes through
 * the same allowed-roots check as the git routes so the sidebar can't be
 * used to spin up a workspace rooted at an arbitrary path on disk.
 */
export function herdrRoutes(deps: HerdrRoutesDeps) {
  const allowedRoots = deps.allowedRoots ?? [];

  const app = new Hono()
    .post("/workspace", vValidator("json", WorkspaceCreateBodySchema), async (c) => {
      const { cwd, label, focus } = c.req.valid("json");

      if (!(await isAllowedRoot(cwd, allowedRoots))) {
        if (!(await pathExists(cwd))) return c.json({ error: "not-found" as const }, 404);
        return c.json({ error: "forbidden" as const }, 403);
      }

      try {
        const workspace = await deps.gateway.workspaceCreate({
          cwd,
          label: label ?? null,
          focus: focus ?? false,
        });
        const body: WorkspaceCreateResponse = { workspaceId: workspace.workspace_id };
        return c.json(body, 201);
      } catch (err) {
        return c.json(
          { error: "internal" as const, message: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    })
    .post(
      "/workspace/:id/rename",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("json", WorkspaceRenameBodySchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const { label } = c.req.valid("json");

        try {
          const workspace = await deps.gateway.workspaceRename(id, label);
          return c.json({ workspace }, 200);
        } catch (err) {
          return c.json(
            {
              error: "internal" as const,
              message: err instanceof Error ? err.message : String(err),
            },
            500,
          );
        }
      },
    )
    .post(
      "/workspace/:id/close",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("json", WorkspaceCloseBodySchema),
      async (c) => {
        const { id } = c.req.valid("param");

        try {
          await deps.gateway.workspaceClose(id);
          return c.json({ ok: true as const }, 200);
        } catch (err) {
          return c.json(
            {
              error: "internal" as const,
              message: err instanceof Error ? err.message : String(err),
            },
            500,
          );
        }
      },
    );

  return app;
}
