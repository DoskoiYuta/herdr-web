import { hc } from "hono/client";
import * as v from "valibot";
import type { AppType } from "../../server/app";
import { ClientConfigSchema, type ClientConfig } from "../../contract/config";
import {
  CommitDetailSchema,
  FetchResultSchema,
  FilesResponseSchema,
  GraphResponseSchema,
  PatchResponseSchema,
  RootResponseSchema,
  SubReposResponseSchema,
} from "../../contract/git";
import {
  type CreateReviewRequest,
  ForDiffMatchSchema,
  type ForDiffRequest,
  type ListReviewQuery,
  type ReanchorRequest,
  type ReplyRequest,
  ReviewSchema,
} from "../../contract/review";
import { WorkspaceInfoSchema } from "../../contract/herdr";
export type { ForDiffMatch } from "../../contract/review";

/**
 * Hono RPC クライアント。`AppType` は type-only import のみ許可されている
 * （.dependency-cruiser.cjs の `web-only-contract` を参照）。
 *
 * fetch のレスポンスはワイヤを信用せず、必ず valibot スキーマで parse する。
 */
const client = hc<AppType>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost",
);

/** Thrown by `gitApi.fetch` when the server reports a fetch already running
 * for that repo (HTTP 409). */
export class FetchBusyError extends Error {
  constructor() {
    super("実行中です");
    this.name = "FetchBusyError";
  }
}

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

  /** `git fetch --prune` for `repo`. Never throws on a non-zero exit or a
   * timeout — those come back on the resolved `FetchResult` (`code`,
   * `timedOut`). Throws `FetchBusyError` when a fetch is already running for
   * `repo` (HTTP 409), or a generic `Error` for any other non-2xx. */
  async fetch(repo: string) {
    const res = await client.api.git.fetch.$post({ query: { repo } });
    if (res.status === 409) throw new FetchBusyError();
    if (!res.ok) throw new Error(`POST /api/git/fetch failed: ${res.status}`);
    return v.parse(FetchResultSchema, await res.json());
  },

  async subrepos(repo: string) {
    const res = await client.api.git.subrepos.$get({ query: { repo } });
    if (!res.ok) throw new Error(`GET /api/git/subrepos failed: ${res.status}`);
    return v.parse(SubReposResponseSchema, await res.json());
  },
};

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

const WorkspaceCreateResponseSchema = v.object({ workspaceId: v.string() });
const WorkspaceRenameResponseSchema = v.object({ workspace: WorkspaceInfoSchema });

export const herdrApi = {
  async createWorkspace(params: { cwd: string; label?: string; focus?: boolean }) {
    const res = await client.api.herdr.workspace.$post({
      json: {
        cwd: params.cwd,
        ...(params.label !== undefined ? { label: params.label } : {}),
        ...(params.focus !== undefined ? { focus: params.focus } : {}),
      },
    });
    if (!res.ok) throw new Error(`POST /api/herdr/workspace failed: ${res.status}`);
    return v.parse(WorkspaceCreateResponseSchema, await res.json());
  },

  async renameWorkspace(id: string, label: string) {
    const res = await client.api.herdr.workspace[":id"].rename.$post({
      param: { id },
      json: { label },
    });
    if (!res.ok) throw new Error(`POST /api/herdr/workspace/:id/rename failed: ${res.status}`);
    return v.parse(WorkspaceRenameResponseSchema, await res.json());
  },

  async closeWorkspace(id: string, opts: { confirm: true }) {
    const res = await client.api.herdr.workspace[":id"].close.$post({
      param: { id },
      json: opts,
    });
    if (!res.ok) throw new Error(`POST /api/herdr/workspace/:id/close failed: ${res.status}`);
    return (await res.json()) as { ok: true };
  },
};

export const configApi = {
  async get(): Promise<ClientConfig> {
    const res = await client.api.config.$get();
    if (!res.ok) throw new Error(`GET /api/config failed: ${res.status}`);
    return v.parse(ClientConfigSchema, await res.json());
  },
};
