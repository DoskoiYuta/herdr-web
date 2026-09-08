import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  ClearWorktreeOverrideQuerySchema,
  SetWorktreeOverrideRequestSchema,
  WhoamiQuerySchema,
  type WhoamiResponse,
  type WorktreeOverrideResponse,
} from "../../contract/hw";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { resolveWhoami } from "../herdr/whoami";

export type HwRoutesDeps = {
  state: HerdrStateStore;
  resolver: WorktreeResolver;
};

/** `hw` CLI 用: HERDR_PANE_ID からセッションと worktree を解決する (plan §9.4)。 */
export function hwRoutes(deps: HwRoutesDeps) {
  return new Hono()
    .get("/whoami", vValidator("query", WhoamiQuerySchema), async (c) => {
      const { pane: paneId } = c.req.valid("query");
      const info = await resolveWhoami(deps, paneId);
      if (!info) return c.json({ error: "pane not found" as const }, 404);
      const body: WhoamiResponse = info;
      return c.json(body, 200);
    })
    .post("/worktree", vValidator("json", SetWorktreeOverrideRequestSchema), async (c) => {
      const { pane, root } = c.req.valid("json");
      const paneInfo = deps.state.get().panes.get(pane);
      if (!paneInfo) return c.json({ error: "pane not found" as const }, 404);
      const info = await deps.resolver.resolve(root).catch(() => null);
      if (!info) return c.json({ error: "not a git worktree" as const }, 400);

      // The pane's actual (herdr-reported) worktree already matches — declaring
      // it again would be a harmless no-op at best, but a wrong 誤宣言 (e.g. a
      // hook mis-extracting a path) landing here must not create an override
      // that then has to be manually cleared. Clear any stale override instead.
      const rawCwd = paneInfo.foreground_cwd ?? paneInfo.cwd ?? null;
      const rawInfo = rawCwd ? await deps.resolver.resolve(rawCwd).catch(() => null) : null;
      if (rawInfo && rawInfo.root === info.root) {
        deps.state.clearWorktreeOverride(pane);
        const body: WorktreeOverrideResponse = { pane, root: info.root };
        return c.json(body, 200);
      }

      const result = deps.state.setWorktreeOverride(pane, info.root);
      if (!result.ok) return c.json({ error: "pane not found" as const }, 404);
      const body: WorktreeOverrideResponse = { pane, root: info.root };
      return c.json(body, 200);
    })
    .delete("/worktree", vValidator("query", ClearWorktreeOverrideQuerySchema), async (c) => {
      const { pane } = c.req.valid("query");
      if (!deps.state.get().panes.has(pane))
        return c.json({ error: "pane not found" as const }, 404);
      deps.state.clearWorktreeOverride(pane);
      const info = await resolveWhoami(deps, pane);
      const body: WorktreeOverrideResponse = { pane, root: info?.worktreeRoot ?? null };
      return c.json(body, 200);
    });
}
