import { hc } from "hono/client";
import * as v from "valibot";
import type { Ask, AskWithSession } from "../contract/ask";
import { AskSchema, AskWithSessionSchema } from "../contract/ask";
import type { CreateDecisionRequest, Decision } from "../contract/decision";
import { CreateDecisionResponseSchema, DecisionSchema } from "../contract/decision";
import type { Health } from "../contract/health";
import { HealthSchema } from "../contract/health";
import type { WhoamiResponse, WorktreeOverrideResponse } from "../contract/hw";
import { WhoamiResponseSchema, WorktreeOverrideResponseSchema } from "../contract/hw";
import type { Review, RepoMoveResult } from "../contract/review";
import { ReviewSchema, RepoMoveResultSchema } from "../contract/review";
export type { RepoMoveResult } from "../contract/review";
// `AppType` is a type-only import — src/cli may not import server runtime code
// (see .dependency-cruiser.cjs `cli-only-contract`).
import type { AppType } from "../server/app";

export type ClientError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; message: string; type: string | null };

export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: ClientError };

export type ListReviewsParams = {
  repo?: string;
  worktree?: string;
  commit?: string;
  since?: string;
  path?: string;
  uncommitted?: boolean;
  unreachable?: boolean;
  all?: boolean;
};

/** Structural subset of `Response`/Hono's `ClientResponse` that `call` needs. */
type MinimalResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** Server error bodies are `{ error: string, type?: string }` (see `mapUsecaseError`, `GET /:id`). */
async function readError(res: MinimalResponse): Promise<{ message: string; type: string | null }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error: unknown }).error;
      const type = "type" in body ? (body as { type: unknown }).type : undefined;
      if (typeof err === "string") {
        return { message: err, type: typeof type === "string" ? type : null };
      }
    }
  } catch {
    // fall through to the generic message below
  }
  return { message: `HTTP ${res.status}`, type: null };
}

async function call<T>(
  fn: () => Promise<MinimalResponse>,
  schema: v.GenericSchema<unknown, T>,
): Promise<ClientResult<T>> {
  let res: MinimalResponse;
  try {
    res = await fn();
  } catch (err) {
    return {
      ok: false,
      error: { kind: "network", message: err instanceof Error ? err.message : String(err) },
    };
  }
  if (!res.ok) {
    const { message, type } = await readError(res);
    return {
      ok: false,
      error: { kind: "http", status: res.status, message, type },
    };
  }
  return { ok: true, value: v.parse(schema, await res.json()) };
}

function boolQuery(value: boolean | undefined): string | undefined {
  return value ? "true" : undefined;
}

export type HwClient = ReturnType<typeof createHwClient>;

/** Typed Hono RPC client for the `hw` CLI, per plan §9.4 (shared with the Web UI). */
export function createHwClient(baseUrl: string) {
  const client = hc<AppType>(baseUrl);

  return {
    health(): Promise<ClientResult<Health>> {
      return call(() => client.api.health.$get(), HealthSchema);
    },

    whoami(pane: string): Promise<ClientResult<WhoamiResponse>> {
      return call(() => client.api.hw.whoami.$get({ query: { pane } }), WhoamiResponseSchema);
    },

    setWorktreeOverride(
      pane: string,
      root: string,
    ): Promise<ClientResult<WorktreeOverrideResponse>> {
      return call(
        () => client.api.hw.worktree.$post({ json: { pane, root } }),
        WorktreeOverrideResponseSchema,
      );
    },

    clearWorktreeOverride(pane: string): Promise<ClientResult<WorktreeOverrideResponse>> {
      return call(
        () => client.api.hw.worktree.$delete({ query: { pane } }),
        WorktreeOverrideResponseSchema,
      );
    },

    listReviews(params: ListReviewsParams): Promise<ClientResult<Review[]>> {
      return call(
        () =>
          client.api.review.$get({
            query: {
              ...(params.repo !== undefined ? { repo: params.repo } : {}),
              ...(params.worktree !== undefined ? { worktree: params.worktree } : {}),
              ...(params.commit !== undefined ? { commit: params.commit } : {}),
              ...(params.since !== undefined ? { since: params.since } : {}),
              ...(params.path !== undefined ? { path: params.path } : {}),
              ...(boolQuery(params.uncommitted) !== undefined
                ? { uncommitted: boolQuery(params.uncommitted) }
                : {}),
              ...(boolQuery(params.unreachable) !== undefined
                ? { unreachable: boolQuery(params.unreachable) }
                : {}),
              ...(boolQuery(params.all) !== undefined ? { all: boolQuery(params.all) } : {}),
            },
          }),
        v.array(ReviewSchema),
      );
    },

    getReview(id: string): Promise<ClientResult<Review>> {
      return call(() => client.api.review[":id"].$get({ param: { id } }), ReviewSchema);
    },

    replyToReview(
      id: string,
      body: string,
      agentSession: string | null,
    ): Promise<ClientResult<Review>> {
      return call(
        () =>
          client.api.review[":id"].reply.$post({
            param: { id },
            json: { body, author: "agent", agentSession },
          }),
        ReviewSchema,
      );
    },

    createDecision(
      req: CreateDecisionRequest,
    ): Promise<ClientResult<{ id: string; url: string; paneResolved: boolean }>> {
      return call(() => client.api.decision.$post({ json: req }), CreateDecisionResponseSchema);
    },

    getDecision(id: string): Promise<ClientResult<Decision>> {
      return call(() => client.api.decision[":id"].$get({ param: { id } }), DecisionSchema);
    },

    listDecisions(params: ListDecisionsParams): Promise<ClientResult<Decision[]>> {
      return call(
        () =>
          client.api.decision.$get({
            query: {
              ...(params.status !== undefined ? { status: params.status } : {}),
              ...(params.worktreeRoot !== undefined ? { worktreeRoot: params.worktreeRoot } : {}),
            },
          }),
        v.array(DecisionSchema),
      );
    },

    cancelDecision(id: string): Promise<ClientResult<Decision>> {
      return call(() => client.api.decision[":id"].cancel.$post({ param: { id } }), DecisionSchema);
    },

    decisionSchema(): Promise<ClientResult<unknown>> {
      return call(() => client.api.decision.schema.$get(), v.unknown());
    },

    moveRepo(from: string, to: string): Promise<ClientResult<RepoMoveResult>> {
      return call(() => client.api.repo.move.$post({ json: { from, to } }), RepoMoveResultSchema);
    },

    listAsks(params: ListAsksParams): Promise<ClientResult<Ask[]>> {
      return call(
        () =>
          client.api.ask.$get({
            query: {
              ...(params.repo !== undefined ? { repo: params.repo } : {}),
              ...(params.worktree !== undefined ? { worktree: params.worktree } : {}),
              ...(params.status !== undefined ? { status: params.status } : {}),
              ...(params.path !== undefined ? { path: params.path } : {}),
            },
          }),
        v.array(AskSchema),
      );
    },

    getAsk(id: string): Promise<ClientResult<AskWithSession>> {
      return call(() => client.api.ask[":id"].$get({ param: { id } }), AskWithSessionSchema);
    },

    replyToAsk(id: string, body: string, agentSession: string | null): Promise<ClientResult<Ask>> {
      return call(
        () =>
          client.api.ask[":id"].reply.$post({
            param: { id },
            json: { body, author: "agent", agentSession },
          }),
        AskSchema,
      );
    },
  };
}

export type ListDecisionsParams = {
  /** comma-separated DecisionStatus */
  status?: string;
  worktreeRoot?: string;
};

export type ListAsksParams = {
  repo?: string;
  worktree?: string;
  /** comma-separated AskStatus */
  status?: string;
  path?: string;
};
