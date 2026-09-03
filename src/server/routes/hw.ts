import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { WhoamiQuerySchema, type WhoamiResponse } from "../../contract/hw";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";

export type HwRoutesDeps = {
  state: HerdrStateStore;
  resolver: WorktreeResolver;
};

/** `hw` CLI 用: HERDR_PANE_ID からセッションと worktree を解決する (plan §9.4)。 */
export function hwRoutes(deps: HwRoutesDeps) {
  return new Hono().get("/whoami", vValidator("query", WhoamiQuerySchema), async (c) => {
    const { pane: paneId } = c.req.valid("query");
    const pane = deps.state.get().panes.get(paneId);
    if (!pane) return c.json({ error: "pane not found" as const }, 404);
    const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
    const info = cwd ? await deps.resolver.resolve(cwd).catch(() => null) : null;
    const body: WhoamiResponse = {
      pane: pane.pane_id,
      workspace: pane.workspace_id,
      cwd: pane.cwd ?? null,
      foregroundCwd: pane.foreground_cwd ?? null,
      worktreeRoot: info?.root ?? null,
      repoKey: info?.commonDir ?? null,
      agent: pane.agent ?? null,
      agentSession: pane.agent_session ?? null,
    };
    return c.json(body, 200);
  });
}
