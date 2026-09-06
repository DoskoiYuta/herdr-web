import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import {
  AskCountsQuerySchema,
  AskReplyRequestSchema,
  CreateAskRequestSchema,
  ForFileRequestSchema,
  ListAskQuerySchema,
  type Ask,
  type AskStatus,
} from "../../contract/ask";
import type { AskRepository, LaunchError } from "../ask/ports";
import type { AskService } from "../ask/service";
import { resolveShortId } from "./short-id";

export type AskRoutesDeps = {
  repository: AskRepository;
  service: AskService;
};

type FindByIdResult = { kind: "found"; ask: Ask } | { kind: "not_found" } | { kind: "ambiguous" };

async function findAskByIdOrSuffix(repository: AskRepository, id: string): Promise<FindByIdResult> {
  const result = await resolveShortId(id, {
    getFull: (fullId) => repository.get(fullId),
    listCandidates: () => repository.list({}),
    idOf: (a) => a.id,
  });
  if (result.kind === "found") return { kind: "found", ask: result.value };
  return result;
}

function mapLaunchError(error: LaunchError) {
  if (error.type === "limit_reached") {
    return { body: { error: "limit_reached", limit: error.limit }, status: 409 as const };
  }
  if (error.type === "herdr_unavailable") {
    return { body: { error: "herdr_unavailable" }, status: 503 as const };
  }
  return { body: { error: error.message, type: "failed" }, status: 500 as const };
}

export function askRoutes(deps: AskRoutesDeps) {
  const app = new Hono()
    .get("/", vValidator("query", ListAskQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const status = query.status
        ? (query.status.split(",").filter(Boolean) as AskStatus[])
        : undefined;
      const asks = await deps.service.listAsks({
        repo: query.repo,
        worktreeRoot: query.worktree,
        status,
        path: query.path,
      });
      return c.json(asks);
    })
    .get("/counts", vValidator("query", AskCountsQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const counts = await deps.service.counts(query.repo, query.worktree);
      return c.json(counts);
    })
    .post("/for-file", vValidator("json", ForFileRequestSchema), async (c) => {
      const matches = await deps.service.forFile(c.req.valid("json"));
      return c.json({ matches });
    })
    .post("/", vValidator("json", CreateAskRequestSchema), async (c) => {
      const result = await deps.service.createAsk(c.req.valid("json"));
      return result.match(
        (ask) => c.json(ask, 201),
        (error) => {
          const mapped = mapLaunchError(error);
          return c.json(mapped.body, mapped.status);
        },
      );
    })
    .get("/:id", async (c) => {
      const found = await findAskByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "ask not found" }, 404);
      }
      const withSession = await deps.service.getAskWithSession(found.ask.id);
      return c.json(withSession);
    })
    .post("/:id/reply", vValidator("json", AskReplyRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const found = await findAskByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "ask not found" }, 404);
      }
      const result = await deps.service.replyAsk({ id: found.ask.id, ...body });
      return result.match(
        (ask) => c.json(ask),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    })
    .post("/:id/resolve", async (c) => {
      const found = await findAskByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "ask not found" }, 404);
      }
      const result = await deps.service.resolveAsk(found.ask.id);
      return result.match(
        (ask) => c.json(ask),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    })
    .post("/:id/resend", async (c) => {
      const found = await findAskByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "ask not found" }, 404);
      }
      const result = await deps.service.resendPrompt(found.ask.id);
      return result.match(
        (ask) => c.json(ask),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    })
    .post("/:id/focus", async (c) => {
      const found = await findAskByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "ask not found" }, 404);
      }
      const result = await deps.service.focusSession(found.ask.id);
      return result.match(
        () => c.json({ ok: true }),
        (error) => c.json({ error: error.message, type: error.type }, 404),
      );
    });

  return app;
}

export type AskRoutesType = ReturnType<typeof askRoutes>;
