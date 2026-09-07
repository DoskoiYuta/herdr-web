import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { InboxQuerySchema } from "../../contract/inbox";
import type { InboxService } from "./service";

export type InboxRoutesDeps = {
  service: InboxService;
};

export function inboxRoutes(deps: InboxRoutesDeps) {
  const app = new Hono().get("/", vValidator("query", InboxQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const body = await deps.service.getInbox(query.worktree);
    return c.json(body);
  });

  return app;
}

export type InboxRoutesType = ReturnType<typeof inboxRoutes>;
