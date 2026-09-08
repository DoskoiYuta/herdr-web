import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import * as v from "valibot";
import {
  AnswerDecisionRequestSchema,
  CreateDecisionRequestSchema,
  DECISION_SPEC_MAX_BYTES,
  decisionSpecJsonSchema,
  DecisionCountsQuerySchema,
  ListDecisionQuerySchema,
  type Decision,
  type DecisionStatus,
} from "../../contract/decision";
import type { DecisionRepository } from "../decision/ports";
import type { DecisionService } from "../decision/service";
import { resolveShortId } from "./short-id";

export type DecisionRoutesDeps = {
  repository: DecisionRepository;
  service: DecisionService;
  /** `http://<host>:<port>/decisions/<id>` の形の URL を組み立てる (plan §9.w)。 */
  buildUrl: (id: string) => string;
};

type FindByIdResult =
  | { kind: "found"; decision: Decision }
  | { kind: "not_found" }
  | { kind: "ambiguous" };

async function findDecisionByIdOrSuffix(
  repository: DecisionRepository,
  id: string,
): Promise<FindByIdResult> {
  const result = await resolveShortId(id, {
    getFull: (fullId) => repository.get(fullId),
    listCandidates: () => repository.list({}),
    idOf: (d) => d.id,
  });
  if (result.kind === "found") return { kind: "found", decision: result.value };
  return result;
}

export function decisionRoutes(deps: DecisionRoutesDeps) {
  const app = new Hono()
    .get("/schema", (c) => c.json(decisionSpecJsonSchema()))
    .get("/counts", vValidator("query", DecisionCountsQuerySchema), async (c) =>
      c.json(await deps.service.counts(c.req.valid("query").worktreeRoot)),
    )
    .get("/", vValidator("query", ListDecisionQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const status = query.status
        ? (query.status.split(",").filter(Boolean) as DecisionStatus[])
        : undefined;
      const decisions = await deps.service.listDecisions({
        status,
        worktreeRoot: query.worktreeRoot,
      });
      return c.json(decisions);
    })
    .post("/", async (c) => {
      // F13-5: 1 MiB 上限は JSON 文字列長で検査する。vValidator は先にパースして
      // しまうので、生テキストの byte 長をここで見てから valibot にかける。
      const raw = await c.req.text();
      if (new TextEncoder().encode(raw).byteLength > DECISION_SPEC_MAX_BYTES) {
        return c.json({ error: "spec too large", type: "too_large" }, 413);
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return c.json({ error: "invalid JSON", type: "invalid_json" }, 400);
      }
      const parsed = v.safeParse(CreateDecisionRequestSchema, json);
      if (!parsed.success) {
        return c.json(
          { error: "invalid request", type: "invalid_request", issues: parsed.issues },
          400,
        );
      }
      const decision = await deps.service.createDecision(parsed.output);
      return c.json(
        { id: decision.id, url: deps.buildUrl(decision.id), paneResolved: decision.paneResolved },
        201,
      );
    })
    .get("/:id", async (c) => {
      const found = await findDecisionByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous")
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      if (found.kind === "not_found") return c.json({ error: "decision not found" }, 404);
      return c.json(found.decision);
    })
    .post("/:id/answer", vValidator("json", AnswerDecisionRequestSchema), async (c) => {
      const found = await findDecisionByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous")
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      if (found.kind === "not_found") return c.json({ error: "decision not found" }, 404);
      const result = await deps.service.answerDecision(found.decision.id, c.req.valid("json"));
      return result.match(
        (decision) => c.json(decision),
        (error) =>
          c.json(
            { error: error.message, type: error.type },
            error.type === "not_found" ? 404 : error.type === "validation" ? 400 : 409,
          ),
      );
    })
    .post("/:id/dismiss", async (c) => {
      const found = await findDecisionByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous")
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      if (found.kind === "not_found") return c.json({ error: "decision not found" }, 404);
      const result = await deps.service.dismissDecision(found.decision.id);
      return result.match(
        (decision) => c.json(decision),
        (error) =>
          c.json(
            { error: error.message, type: error.type },
            error.type === "not_found" ? 404 : 409,
          ),
      );
    })
    .post("/:id/cancel", async (c) => {
      const found = await findDecisionByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous")
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      if (found.kind === "not_found") return c.json({ error: "decision not found" }, 404);
      const result = await deps.service.cancelDecision(found.decision.id);
      return result.match(
        (decision) => c.json(decision),
        (error) =>
          c.json(
            { error: error.message, type: error.type },
            error.type === "not_found" ? 404 : 409,
          ),
      );
    })
    .post("/:id/resend", async (c) => {
      const found = await findDecisionByIdOrSuffix(deps.repository, c.req.param("id"));
      if (found.kind === "ambiguous")
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      if (found.kind === "not_found") return c.json({ error: "decision not found" }, 404);
      const result = await deps.service.resendDecision(found.decision.id);
      return result.match(
        (decision) => c.json(decision),
        (error) =>
          c.json(
            { error: error.message, type: error.type },
            error.type === "not_found" ? 404 : 409,
          ),
      );
    });

  return app;
}

export type DecisionRoutesType = ReturnType<typeof decisionRoutes>;
