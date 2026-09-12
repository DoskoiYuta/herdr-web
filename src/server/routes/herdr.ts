import { realpath as realpathAsync } from "node:fs/promises";
import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  PanePreviewQuerySchema,
  WorkspaceCloseBodySchema,
  WorkspaceCreateBodySchema,
  WorkspaceIdParamSchema,
  WorkspaceSelectionPutBodySchema,
  WorkspaceSelectionQuerySchema,
  WorkspaceRenameBodySchema,
  WorkspaceToolTabPutBodySchema,
  type PanePreviewResponse,
  type WorkspaceCreateResponse,
  type WorkspaceSelectionError,
  type WorkspaceSelectionGetResponse,
  type WorkspaceSelectionPutResponse,
  type WorkspaceToolTabError,
  type WorkspaceToolTabPutResponse,
} from "../../contract/herdr-ops";
import type { HerdrGateway } from "../herdr/gateway";
import type { SubRepoLike, WorktreeEntryLike } from "../herdr/pane-worktree";
import type { HerdrState, HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { isAllowedRoot, pathExists } from "./allowed-roots";

export interface HerdrRoutesDeps {
  gateway: HerdrGateway;
  state: HerdrStateStore;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
  /** Absolute paths a workspace's cwd is allowed to live under, in addition to $HOME. */
  allowedRoots?: string[];
  logger?: Pick<typeof console, "warn">;
}

type SelectionErrorCode = WorkspaceSelectionError["error"];

async function realpathOrSelf(path: string): Promise<string> {
  return realpathAsync(path).catch(() => path);
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
    )
    .get(
      "/workspace/:id/selection",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("query", WorkspaceSelectionQuerySchema),
      (c) => {
        const { id } = c.req.valid("param");
        const { repoKey } = c.req.valid("query");
        const body: WorkspaceSelectionGetResponse = {
          selection: deps.state.getSelection(id, repoKey),
        };
        return c.json(body, 200);
      },
    )
    .put(
      "/workspace/:id/selection",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("json", WorkspaceSelectionPutBodySchema),
      async (c) => {
        const { id: workspaceId } = c.req.valid("param");
        const {
          repoKey,
          worktreeRoot,
          subRepoId: rawSubRepoId,
          subWorktreeRoot,
        } = c.req.valid("json");
        // `""` is `SubRepo.id` for the root entry itself (git/subrepos.ts) — the
        // wire contract's "no sub-repository selected" is `null`, not `""`, so
        // without this a root-entry id would round-trip as a stored `""` and
        // read back as a non-default selection with `subRepo: null`.
        const subRepoId = rawSubRepoId === "" ? null : (rawSubRepoId ?? null);

        function fail(error: SelectionErrorCode) {
          return c.json({ error }, 400);
        }

        if (!deps.state.get().workspaces.has(workspaceId)) return fail("unknown_workspace");

        const worktreeRootReal = await realpathOrSelf(worktreeRoot);
        const repoInfo = await deps.resolver.resolve(worktreeRootReal).catch(() => null);
        if (!repoInfo || repoInfo.commonDir !== repoKey || repoInfo.root !== worktreeRootReal) {
          return fail("worktree_not_in_repo");
        }
        // `resolver.resolve` is cached with no TTL (git/resolve.ts) — a worktree
        // removed after it was last resolved would otherwise still pass the
        // check above. `listWorktrees` has a 5s TTL and, on a cache miss, runs
        // `git worktree list` which itself fails when the directory is gone.
        const currentWorktrees = await deps.listWorktrees(worktreeRootReal).catch(() => []);
        if (!currentWorktrees.some((w) => w.root === worktreeRootReal)) {
          return fail("worktree_not_in_repo");
        }

        let validatedSubRepoId: string | null = null;
        let validatedSubWorktreeRoot: string | null = null;
        if (subRepoId != null) {
          const subRepos = await deps.listSubRepos(worktreeRootReal).catch(() => []);
          const sub = subRepos.find((r) => r.id === subRepoId);
          if (!sub) return fail("unknown_sub_repo");
          validatedSubRepoId = sub.id;

          if (subWorktreeRoot != null) {
            const subWorktreeRootReal = await realpathOrSelf(subWorktreeRoot);
            const found = sub.worktrees.some((w) => w.root === subWorktreeRootReal);
            if (!found) return fail("sub_worktree_not_in_sub_repo");
            validatedSubWorktreeRoot = subWorktreeRootReal;
          }
        }

        const result = await deps.state.setSelection({
          workspaceId,
          repoKey,
          worktreeRoot: worktreeRootReal,
          subRepoId: validatedSubRepoId,
          subWorktreeRoot: validatedSubWorktreeRoot,
        });
        if (!result.ok) return c.json({ error: "persist_failed" as const }, 500);
        const body: WorkspaceSelectionPutResponse = { selection: result.selection };
        return c.json(body, 200);
      },
    )
    .delete(
      "/workspace/:id/selection",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("query", WorkspaceSelectionQuerySchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const { repoKey } = c.req.valid("query");
        const result = await deps.state.clearSelection(id, repoKey);
        if (!result.ok) return c.json({ error: "persist_failed" as const }, 500);
        return c.json({ ok: true as const }, 200);
      },
    )
    .put(
      "/workspace/:id/tool-tab",
      vValidator("param", WorkspaceIdParamSchema),
      vValidator("json", WorkspaceToolTabPutBodySchema),
      async (c) => {
        const { id: workspaceId } = c.req.valid("param");
        const { tab } = c.req.valid("json");

        if (!deps.state.get().workspaces.has(workspaceId)) {
          const body: WorkspaceToolTabError = { error: "unknown_workspace" };
          return c.json(body, 400);
        }

        const result = await deps.state.setToolTab(workspaceId, tab);
        if (!result.ok) return c.json({ error: "persist_failed" as const }, 500);
        const body: WorkspaceToolTabPutResponse = { toolTab: result.toolTab };
        return c.json(body, 200);
      },
    );

  return app;
}
