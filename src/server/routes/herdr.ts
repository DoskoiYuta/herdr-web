import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  PanePreviewQuerySchema,
  WorkspaceCloseBodySchema,
  WorkspaceCreateBodySchema,
  WorkspaceIdParamSchema,
  WorkspaceRenameBodySchema,
  type PanePreviewResponse,
  type WorkspaceCreateResponse,
} from "../../contract/herdr-ops";
import type { HerdrGateway } from "../herdr/gateway";
import type { HerdrState, HerdrStateStore } from "../herdr/state";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface HerdrRoutesDeps {
  gateway: HerdrGateway;
  state: HerdrStateStore;
  /** Absolute paths a workspace's cwd is allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  logger?: Pick<typeof console, "warn">;
}

function paneTitle(pane: { label?: string | null; terminal_title_stripped?: string | null }) {
  return pane.label ?? pane.terminal_title_stripped ?? null;
}

/** Last `n` non-empty lines of `text`, split on newlines. */
function tailLines(text: string, n: number): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-n);
}

async function buildPanePreview(
  deps: Pick<HerdrRoutesDeps, "gateway" | "logger">,
  state: HerdrState,
  paneId: string,
): Promise<PanePreviewResponse> {
  const pane = state.panes.get(paneId)!;
  const logger = deps.logger ?? console;

  const layout = await deps.gateway
    .paneLayout(paneId)
    .then((snapshot) => ({
      area: snapshot.area,
      panes: snapshot.panes.map((p) => {
        const known = state.panes.get(p.pane_id);
        return {
          paneId: p.pane_id,
          focused: p.focused,
          rect: p.rect,
          title: known ? paneTitle(known) : null,
          agent: known?.agent ?? null,
        };
      }),
    }))
    .catch((err: unknown) => {
      logger.warn(`pane-preview: pane.layout failed for ${paneId}`, err);
      return null;
    });

  const tail = await deps.gateway
    .paneRead(paneId, 40)
    .then((text) => tailLines(text, 8))
    .catch((err: unknown) => {
      logger.warn(`pane-preview: pane.read failed for ${paneId}`, err);
      return [];
    });

  return {
    pane: paneId,
    workspaceLabel: state.workspaces.get(pane.workspace_id)?.label ?? null,
    tabLabel: state.tabs.get(pane.tab_id)?.label ?? null,
    title: paneTitle(pane),
    agent: pane.agent ?? null,
    agentStatus: pane.agent_status,
    agentSession: pane.agent_session?.value ?? null,
    layout,
    tail,
  };
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
    .get("/pane-preview", vValidator("query", PanePreviewQuerySchema), async (c) => {
      const { pane: paneId } = c.req.valid("query");
      const state = deps.state.get();
      if (!state.panes.has(paneId)) return c.json({ error: "not-found" as const }, 404);

      const body = await buildPanePreview(deps, state, paneId);
      return c.json(body, 200);
    })
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
