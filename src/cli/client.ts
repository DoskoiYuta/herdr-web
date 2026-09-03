import { hc } from "hono/client";
import * as v from "valibot";
import type { Health } from "../contract/health";
import { HealthSchema } from "../contract/health";
import type { WhoamiResponse } from "../contract/hw";
import { WhoamiResponseSchema } from "../contract/hw";
import type { Review, RepoMoveResult } from "../contract/review";
import { ReviewSchema, RepoMoveResultSchema } from "../contract/review";
export type { RepoMoveResult } from "../contract/review";
// `AppType` is a type-only import — src/cli may not import server runtime code
// (see .dependency-cruiser.cjs `cli-only-contract`).
import type { AppType } from "../server/app";

export type ClientError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; message: string };

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

async function readErrorMessage(res: MinimalResponse): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error: unknown }).error;
      if (typeof err === "string") return err;
    }
  } catch {
    // fall through to the generic message below
  }
  return `HTTP ${res.status}`;
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
    return {
      ok: false,
      error: { kind: "http", status: res.status, message: await readErrorMessage(res) },
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

    moveRepo(from: string, to: string): Promise<ClientResult<RepoMoveResult>> {
      return call(() => client.api.repo.move.$post({ json: { from, to } }), RepoMoveResultSchema);
    },
  };
}
