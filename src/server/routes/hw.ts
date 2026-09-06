import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { WhoamiQuerySchema, type WhoamiResponse } from "../../contract/hw";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { resolveWhoami } from "../herdr/whoami";

export type HwRoutesDeps = {
  state: HerdrStateStore;
  resolver: WorktreeResolver;
};

/** `hw` CLI 用: HERDR_PANE_ID からセッションと worktree を解決する (plan §9.4)。 */
export function hwRoutes(deps: HwRoutesDeps) {
  return new Hono().get("/whoami", vValidator("query", WhoamiQuerySchema), async (c) => {
    const { pane: paneId } = c.req.valid("query");
    const info = await resolveWhoami(deps, paneId);
    if (!info) return c.json({ error: "pane not found" as const }, 404);
    const body: WhoamiResponse = info;
    return c.json(body, 200);
  });
}
