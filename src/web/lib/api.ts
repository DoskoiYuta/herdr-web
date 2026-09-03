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
