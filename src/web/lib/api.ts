import { hc } from "hono/client";
import * as v from "valibot";
import type { AppType } from "../../server/app";
import {
  CommitDetailSchema,
  FilesResponseSchema,
  GraphResponseSchema,
  PatchResponseSchema,
  RootResponseSchema,
} from "../../contract/git";
import {
  type CreateReviewRequest,
  type ForDiffRequest,
  type ListReviewQuery,
  type ReanchorRequest,
  type ReplyRequest,
  ReviewSchema,
} from "../../contract/review";

/**
 * Hono RPC クライアント。`AppType` は type-only import のみ許可されている
 * （.dependency-cruiser.cjs の `web-only-contract` を参照）。
 *
 * fetch のレスポンスはワイヤを信用せず、必ず valibot スキーマで parse する。
 */
const client = hc<AppType>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost",
);

export const gitApi = {
  async root(path: string) {
    const res = await client.api.git.root.$get({ query: { path } });
    if (!res.ok) throw new Error(`GET /api/git/root failed: ${res.status}`);
    return v.parse(RootResponseSchema, await res.json());
  },

  async patch(params: { repo: string; from?: string; to?: string }) {
    const res = await client.api.git.patch.$get({
      query: {
        repo: params.repo,
        ...(params.from !== undefined ? { from: params.from } : {}),
        ...(params.to !== undefined ? { to: params.to } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET /api/git/patch failed: ${res.status}`);
    return v.parse(PatchResponseSchema, await res.json());
  },

  async files(params: {
    repo: string;
    path: string;
    prev?: string;
    type: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
    oldHash?: string;
    newHash?: string;
  }) {
    const res = await client.api.git.files.$get({
      query: {
        repo: params.repo,
        path: params.path,
        type: params.type,
        ...(params.prev !== undefined ? { prev: params.prev } : {}),
        ...(params.oldHash !== undefined ? { oldHash: params.oldHash } : {}),
        ...(params.newHash !== undefined ? { newHash: params.newHash } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET /api/git/files failed: ${res.status}`);
    return v.parse(FilesResponseSchema, await res.json());
  },

  async graph(params: { repo: string; max?: number; all?: boolean }) {
    const res = await client.api.git.graph.$get({
      query: {
        repo: params.repo,
        ...(params.max !== undefined ? { max: String(params.max) } : {}),
        ...(params.all !== undefined ? { all: String(params.all) } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET /api/git/graph failed: ${res.status}`);
    return v.parse(GraphResponseSchema, await res.json());
  },

  async commit(params: { repo: string; hash: string }) {
    const res = await client.api.git.commit[":hash"].$get({
      param: { hash: params.hash },
      query: { repo: params.repo },
    });
    if (!res.ok) throw new Error(`GET /api/git/commit/:hash failed: ${res.status}`);
    return v.parse(CommitDetailSchema, await res.json());
  },
};

/** `{ review, line, confidence }[]` — the shape `POST /api/review/for-diff` resolves. */
export const ForDiffMatchSchema = v.object({
  review: ReviewSchema,
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
  confidence: v.picklist(["exact", "context", "line"]),
});
export type ForDiffMatch = v.InferOutput<typeof ForDiffMatchSchema>;

function toQueryRecord(query: ListReviewQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.repo !== undefined) out.repo = query.repo;
  if (query.worktree !== undefined) out.worktree = query.worktree;
  if (query.status !== undefined) out.status = query.status;
  if (query.commit !== undefined) out.commit = query.commit;
  if (query.since !== undefined) out.since = query.since;
  if (query.uncommitted !== undefined) out.uncommitted = String(query.uncommitted);
  if (query.unreachable !== undefined) out.unreachable = String(query.unreachable);
  if (query.all !== undefined) out.all = String(query.all);
  if (query.path !== undefined) out.path = query.path;
  return out;
}

export const reviewApi = {
  async list(query: ListReviewQuery) {
    const res = await client.api.review.$get({ query: toQueryRecord(query) });
    if (!res.ok) throw new Error(`GET /api/review failed: ${res.status}`);
    return v.parse(v.array(ReviewSchema), await res.json());
  },

  async get(id: string) {
    const res = await client.api.review[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(`GET /api/review/:id failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async forDiff(body: ForDiffRequest) {
    const res = await client.api.review["for-diff"].$post({ json: body });
    if (!res.ok) throw new Error(`POST /api/review/for-diff failed: ${res.status}`);
    return v.parse(v.array(ForDiffMatchSchema), await res.json());
  },

  async create(body: CreateReviewRequest) {
    const res = await client.api.review.$post({ json: body });
    if (!res.ok) throw new Error(`POST /api/review failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async reply(id: string, body: ReplyRequest) {
    const res = await client.api.review[":id"].reply.$post({ param: { id }, json: body });
    if (!res.ok) throw new Error(`POST /api/review/:id/reply failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async resolve(id: string) {
    const res = await client.api.review[":id"].resolve.$post({ param: { id } });
    if (!res.ok) throw new Error(`POST /api/review/:id/resolve failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async reanchor(id: string, body: ReanchorRequest = {}) {
    const res = await client.api.review[":id"].reanchor.$post({ param: { id }, json: body });
    if (!res.ok) throw new Error(`POST /api/review/:id/reanchor failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async notify(id: string) {
    const res = await client.api.review[":id"].notify.$post({ param: { id } });
    if (!res.ok) throw new Error(`POST /api/review/:id/notify failed: ${res.status}`);
    return (await res.json()) as { ok: true };
  },
};
