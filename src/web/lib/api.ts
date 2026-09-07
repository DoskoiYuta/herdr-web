import { hc } from "hono/client";
import * as v from "valibot";
import type { AppType } from "../../server/app";
import { ClientConfigSchema, type ClientConfig } from "../../contract/config";
import { HealthSchema, type Health } from "../../contract/health";
import {
  CommitDetailSchema,
  FetchResultSchema,
  FilesResponseSchema,
  GraphResponseSchema,
  PatchResponseSchema,
  RootResponseSchema,
  StatusResponseSchema,
  SubReposResponseSchema,
} from "../../contract/git";
import {
  FileResponseSchema,
  LsResponseSchema,
  TrashResponseSchema,
  UploadResponseSchema,
} from "../../contract/fs";
import { DockerContainersResponseSchema } from "../../contract/docker";
import { InboxResponseSchema } from "../../contract/inbox";
import { ProcListResponseSchema } from "../../contract/proc";
import {
  type CreateReviewRequest,
  ForDiffMatchSchema,
  type ForDiffRequest,
  type ListReviewQuery,
  type ReanchorRequest,
  type ReplyRequest,
  ReviewCountsResponseSchema,
  ReviewSchema,
  SendDraftsResultSchema,
} from "../../contract/review";
import { WorkspaceInfoSchema } from "../../contract/herdr";
import { PanePreviewResponseSchema } from "../../contract/herdr-ops";
import {
  type AskReplyRequest,
  AskCountsResponseSchema,
  AskSchema,
  AskWithSessionSchema,
  type CreateAskRequest,
  ForFileMatchSchema,
  type ForFileRequest,
  type ListAskQuery,
} from "../../contract/ask";
import {
  type AnswerDecisionRequest,
  DecisionCountsSchema,
  DecisionSchema,
  type ListDecisionQuery,
} from "../../contract/decision";
export type { ForDiffMatch } from "../../contract/review";
export type { Ask, AskWithSession, ForFileMatch } from "../../contract/ask";
export type { Decision } from "../../contract/decision";
export type { InboxItem, InboxResponse, InboxSection } from "../../contract/inbox";

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

/** Thrown by `reviewApi.send` on HTTP 409 — the server couldn't resolve a
 * unique send target. `targets` (candidate pane ids) is only present for
 * `ambiguous_target`. */
export class SendTargetError extends Error {
  type: "no_agent" | "ambiguous_target" | "invalid_target";
  targets?: string[];
  constructor(type: "no_agent" | "ambiguous_target" | "invalid_target", targets?: string[]) {
    super(type);
    this.name = "SendTargetError";
    this.type = type;
    this.targets = targets;
  }
}

/** Thrown by `fsApi.file` when the server reports the path missing (HTTP 404). */
export class FileNotFoundError extends Error {
  path: string;
  constructor(path: string) {
    super(`not found: ${path}`);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}

/** Thrown by `fsApi.upload` when the server reports a destination already
 * exists (HTTP 409). `paths` are relative to the upload's `dir`. */
export class UploadConflictError extends Error {
  paths: string[];
  constructor(paths: string[]) {
    super("既存のファイルと衝突しました");
    this.name = "UploadConflictError";
    this.paths = paths;
  }
}

/** Thrown by `fsApi.trash` when the server has no OS-trash backend (HTTP 501). */
export class TrashUnavailableError extends Error {
  constructor() {
    super("この環境ではゴミ箱に移動できません");
    this.name = "TrashUnavailableError";
  }
}

/** Thrown by `askApi.create` when the repo/worktree already has the max
 * number of open ask sessions (HTTP 409 `limit_reached`). */
export class AskLimitError extends Error {
  limit: number;
  constructor(limit: number) {
    super(`質問セッションの上限 (${limit}) に達しています。解決して閉じてください`);
    this.name = "AskLimitError";
    this.limit = limit;
  }
}

/** Thrown by `askApi.create` when herdr isn't connected (HTTP 503 `herdr_unavailable`). */
export class AskUnavailableError extends Error {
  constructor() {
    super("herdr 未接続");
    this.name = "AskUnavailableError";
  }
}

/** Thrown by `askApi.create` when the requested agent isn't in `config.ask.agents`
 * (HTTP 400 `unknown_agent`). */
export class AskUnknownAgentError extends Error {
  agents: string[];
  constructor(agents: string[]) {
    super("対応していないエージェントです");
    this.name = "AskUnknownAgentError";
    this.agents = agents;
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

  async status(repo: string) {
    const res = await client.api.git.status.$get({ query: { repo } });
    if (!res.ok) throw new Error(`GET /api/git/status failed: ${res.status}`);
    return v.parse(StatusResponseSchema, await res.json());
  },
};

export const fsApi = {
  /** One directory's own (non-recursive) entries; `dir: ""` is `root` itself. */
  async ls(params: { root: string; dir: string }) {
    const res = await client.api.fs.ls.$get({ query: params });
    if (!res.ok) throw new Error(`GET /api/fs/ls failed: ${res.status}`);
    return v.parse(LsResponseSchema, await res.json());
  },

  /** Throws `FileNotFoundError` on HTTP 404 (a tracked file deleted from the
   * worktree, or a path that vanished between tree fetch and click). */
  async file(params: { root: string; path: string }) {
    const res = await client.api.fs.file.$get({ query: params });
    if (res.status === 404) throw new FileNotFoundError(params.path);
    if (!res.ok) throw new Error(`GET /api/fs/file failed: ${res.status}`);
    return v.parse(FileResponseSchema, await res.json());
  },

  /** URL for an image/PDF preview (F9-4), served by `GET /api/fs/raw`. Not
   * fetched through here — used directly as an `<img src>`/`<iframe src>`.
   * `tick` (`repoChangedTick`) is appended so a file change on disk busts
   * the browser's own cache for that URL, not just TanStack Query's. */
  rawUrl(params: { root: string; path: string; tick: number }): string {
    const url = client.api.fs.raw.$url({ query: { root: params.root, path: params.path } });
    url.searchParams.set("t", String(params.tick));
    return url.toString();
  },

  /** DnD import of dropped files/folders (F9-7). Each `File`'s `.name` is
   * sent as the multipart part filename, which the server treats as the
   * path relative to `dir` — pass a relative path (e.g. `photos/a.jpg`) as
   * the `File`'s name for a dropped folder's contents. The Hono RPC `form`
   * option can't send repeated `file` parts, so this builds `FormData` and
   * hits the URL directly rather than going through `hc`.
   * Throws `UploadConflictError` on HTTP 409, a generic `Error` otherwise. */
  async upload(params: { root: string; dir: string; files: File[]; overwrite?: boolean }) {
    const url = client.api.fs.upload.$url({
      query: {
        root: params.root,
        dir: params.dir,
        ...(params.overwrite !== undefined ? { overwrite: String(params.overwrite) } : {}),
      },
    });
    const formData = new FormData();
    for (const file of params.files) {
      formData.append("file", file, file.name);
    }
    const res = await fetch(url, { method: "POST", body: formData });
    if (res.status === 409) {
      const body = (await res.json()) as { paths: string[] };
      throw new UploadConflictError(body.paths);
    }
    if (!res.ok) throw new Error(`POST /api/fs/upload failed: ${res.status}`);
    return v.parse(UploadResponseSchema, await res.json());
  },

  /** Moves `path` to the OS trash (never `rm`). Throws `TrashUnavailableError`
   * on HTTP 501 (no backend on this machine), a generic `Error` otherwise. */
  async trash(params: { root: string; path: string }) {
    const res = await client.api.fs.trash.$post({ query: params });
    if (res.status === 501) throw new TrashUnavailableError();
    if (!res.ok) throw new Error(`POST /api/fs/trash failed: ${res.status}`);
    return v.parse(TrashResponseSchema, await res.json());
  },
};

/** Thrown by `dockerApi.containers` / `procApi.list` on HTTP 501 — the
 * `docker`/`ps`/`lsof` binary itself is missing on this machine. */
export class CommandUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandUnavailableError";
  }
}

/** Thrown on HTTP 503 (non-zero exit — e.g. Docker daemon unreachable, or a
 * `ps`/`lsof` failure). `detail` is the server's stderr, appended to the
 * message for display. */
export class CommandFailedError extends Error {
  detail: string;
  constructor(message: string, detail: string) {
    super(detail ? `${message}: ${detail}` : message);
    this.name = "CommandFailedError";
    this.detail = detail;
  }
}

/** Thrown on HTTP 504 — the server's 5s exec timeout elapsed. */
export class CommandTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandTimeoutError";
  }
}

async function throwOnCommandError(
  res: { status: number; json: () => Promise<unknown> },
  missingMessage: string | ((command?: string) => string),
  failedMessage: string,
  timeoutMessage: string,
): Promise<void> {
  if (res.status === 501) {
    const body = (await res.json()) as { command?: string };
    const message =
      typeof missingMessage === "function" ? missingMessage(body.command) : missingMessage;
    throw new CommandUnavailableError(message);
  }
  if (res.status === 503) {
    const body = (await res.json()) as { message?: string };
    throw new CommandFailedError(failedMessage, body.message ?? "");
  }
  if (res.status === 504) throw new CommandTimeoutError(timeoutMessage);
}

export const dockerApi = {
  /** Containers tied to `root`, grouped by compose project / devcontainer.
   * Throws `CommandUnavailableError` (`docker` missing), `CommandFailedError`
   * (non-zero exit, e.g. daemon unreachable), or `CommandTimeoutError`. */
  async containers(root: string) {
    const res = await client.api.docker.containers.$get({ query: { root } });
    await throwOnCommandError(
      res,
      "docker が見つかりません",
      "Docker daemon に接続できません",
      "docker ps がタイムアウトしました",
    );
    if (!res.ok) throw new Error(`GET /api/docker/containers failed: ${res.status}`);
    return v.parse(DockerContainersResponseSchema, await res.json());
  },
};

export const procApi = {
  /** Processes whose cwd is under `root` (flat; the client builds the ppid
   * tree). Throws `CommandUnavailableError` (`lsof`/`ps` missing —
   * distinguished by the server's `command` field), `CommandFailedError`
   * (non-zero exit), or `CommandTimeoutError`. */
  async list(root: string) {
    const res = await client.api.proc.list.$get({ query: { root } });
    await throwOnCommandError(
      res,
      (command) => (command === "ps" ? "ps が見つかりません" : "lsof が見つかりません"),
      "プロセス一覧の取得に失敗しました",
      "プロセス一覧の取得がタイムアウトしました",
    );
    if (!res.ok) throw new Error(`GET /api/proc/list failed: ${res.status}`);
    return v.parse(ProcListResponseSchema, await res.json());
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
  // The Web UI is the only reviewApi consumer (`hw` talks to the server
  // directly, not through this client) and always needs draft entries —
  // list()/get() force `drafts=true` rather than taking it as a param.
  async list(query: ListReviewQuery) {
    const res = await client.api.review.$get({
      query: { ...toQueryRecord(query), drafts: "true" },
    });
    if (!res.ok) throw new Error(`GET /api/review failed: ${res.status}`);
    return v.parse(v.array(ReviewSchema), await res.json());
  },

  async get(id: string) {
    // The route reads `drafts` via `c.req.query` directly rather than a
    // vValidator schema, so `hc` doesn't type it as a query param — append
    // it to the generated URL instead.
    const url = client.api.review[":id"].$url({ param: { id } });
    url.searchParams.set("drafts", "true");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /api/review/:id failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async counts(params: { repo: string; worktree: string }) {
    const res = await client.api.review.counts.$get({ query: params });
    if (!res.ok) throw new Error(`GET /api/review/counts failed: ${res.status}`);
    return v.parse(ReviewCountsResponseSchema, await res.json());
  },

  async send(params: { repo: string; worktreeRoot: string; pane?: string }) {
    const res = await client.api.review.send.$post({ json: params });
    if (res.status === 409) {
      const body = (await res.json()) as { type: SendTargetError["type"]; targets?: string[] };
      throw new SendTargetError(body.type, body.targets);
    }
    if (!res.ok) throw new Error(`POST /api/review/send failed: ${res.status}`);
    return v.parse(SendDraftsResultSchema, await res.json());
  },

  async editDraft(id: string, seq: number, body: string) {
    const res = await client.api.review[":id"].draft[":seq"].$put({
      param: { id, seq: String(seq) },
      json: { body },
    });
    if (!res.ok) throw new Error(`PUT /api/review/:id/draft/:seq failed: ${res.status}`);
    return v.parse(ReviewSchema, await res.json());
  },

  async deleteDraft(id: string, seq: number) {
    const res = await client.api.review[":id"].draft[":seq"].$delete({
      param: { id, seq: String(seq) },
    });
    if (!res.ok) throw new Error(`DELETE /api/review/:id/draft/:seq failed: ${res.status}`);
    return v.parse(
      v.object({ deleted: v.boolean(), review: v.nullable(ReviewSchema) }),
      await res.json(),
    );
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

  async panePreview(pane: string) {
    const res = await client.api.herdr["pane-preview"].$get({ query: { pane } });
    if (!res.ok) throw new Error(`GET /api/herdr/pane-preview failed: ${res.status}`);
    return v.parse(PanePreviewResponseSchema, await res.json());
  },
};

export const askApi = {
  async list(query: ListAskQuery) {
    const res = await client.api.ask.$get({
      query: {
        ...(query.repo !== undefined ? { repo: query.repo } : {}),
        ...(query.worktree !== undefined ? { worktree: query.worktree } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.path !== undefined ? { path: query.path } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET /api/ask failed: ${res.status}`);
    return v.parse(v.array(AskSchema), await res.json());
  },

  async create(body: CreateAskRequest) {
    const res = await client.api.ask.$post({ json: body });
    if (res.status === 409) {
      const errBody = (await res.json()) as { error: "limit_reached"; limit: number };
      throw new AskLimitError(errBody.limit);
    }
    if (res.status === 503) throw new AskUnavailableError();
    if (res.status === 400) {
      const errBody = (await res.json()) as { error: "unknown_agent"; agents: string[] };
      throw new AskUnknownAgentError(errBody.agents);
    }
    if (!res.ok) throw new Error(`POST /api/ask failed: ${res.status}`);
    return v.parse(AskSchema, await res.json());
  },

  async get(id: string) {
    const res = await client.api.ask[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(`GET /api/ask/:id failed: ${res.status}`);
    return v.parse(AskWithSessionSchema, await res.json());
  },

  async reply(id: string, body: AskReplyRequest) {
    const res = await client.api.ask[":id"].reply.$post({ param: { id }, json: body });
    if (!res.ok) throw new Error(`POST /api/ask/:id/reply failed: ${res.status}`);
    return v.parse(AskSchema, await res.json());
  },

  async resolve(id: string) {
    const res = await client.api.ask[":id"].resolve.$post({ param: { id } });
    if (!res.ok) throw new Error(`POST /api/ask/:id/resolve failed: ${res.status}`);
    return v.parse(AskSchema, await res.json());
  },

  async resend(id: string) {
    const res = await client.api.ask[":id"].resend.$post({ param: { id } });
    if (!res.ok) throw new Error(`POST /api/ask/:id/resend failed: ${res.status}`);
    return v.parse(AskSchema, await res.json());
  },

  async focus(id: string) {
    const res = await client.api.ask[":id"].focus.$post({ param: { id } });
    if (!res.ok) throw new Error(`POST /api/ask/:id/focus failed: ${res.status}`);
    return (await res.json()) as { ok: true };
  },

  async forFile(body: ForFileRequest) {
    const res = await client.api.ask["for-file"].$post({ json: body });
    if (!res.ok) throw new Error(`POST /api/ask/for-file failed: ${res.status}`);
    const parsed = v.parse(v.object({ matches: v.array(ForFileMatchSchema) }), await res.json());
    return parsed.matches;
  },

  async counts(params: { repo: string; worktree: string }) {
    const res = await client.api.ask.counts.$get({ query: params });
    if (!res.ok) throw new Error(`GET /api/ask/counts failed: ${res.status}`);
    return v.parse(AskCountsResponseSchema, await res.json());
  },
};

/** サーバーの `{ error, type? }` ボディを読んでメッセージにする — 409（二重回答/再送不可）
 * 等の理由がステータスコードだけでは UI に伝わらないため。 */
async function decisionApiError(
  res: { status: number; json(): Promise<unknown> },
  fallback: string,
): Promise<Error> {
  try {
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return new Error((body as { error: string }).error);
    }
  } catch {
    // fall through to the generic message below
  }
  return new Error(`${fallback}: ${res.status}`);
}

export const decisionApi = {
  async list(query: ListDecisionQuery) {
    const res = await client.api.decision.$get({
      query: {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.worktreeRoot !== undefined ? { worktreeRoot: query.worktreeRoot } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET /api/decision failed: ${res.status}`);
    return v.parse(v.array(DecisionSchema), await res.json());
  },

  async counts() {
    const res = await client.api.decision.counts.$get();
    if (!res.ok) throw new Error(`GET /api/decision/counts failed: ${res.status}`);
    return v.parse(DecisionCountsSchema, await res.json());
  },

  async get(id: string) {
    const res = await client.api.decision[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(`GET /api/decision/:id failed: ${res.status}`);
    return v.parse(DecisionSchema, await res.json());
  },

  async answer(id: string, body: AnswerDecisionRequest) {
    const res = await client.api.decision[":id"].answer.$post({ param: { id }, json: body });
    if (!res.ok) throw await decisionApiError(res, "POST /api/decision/:id/answer failed");
    return v.parse(DecisionSchema, await res.json());
  },

  async dismiss(id: string) {
    const res = await client.api.decision[":id"].dismiss.$post({ param: { id } });
    if (!res.ok) throw await decisionApiError(res, "POST /api/decision/:id/dismiss failed");
    return v.parse(DecisionSchema, await res.json());
  },

  async cancel(id: string) {
    const res = await client.api.decision[":id"].cancel.$post({ param: { id } });
    if (!res.ok) throw await decisionApiError(res, "POST /api/decision/:id/cancel failed");
    return v.parse(DecisionSchema, await res.json());
  },

  async resend(id: string) {
    const res = await client.api.decision[":id"].resend.$post({ param: { id } });
    if (!res.ok) throw await decisionApiError(res, "POST /api/decision/:id/resend failed");
    return v.parse(DecisionSchema, await res.json());
  },
};

export const inboxApi = {
  async get(params: { worktree?: string } = {}) {
    const res = await client.api.inbox.$get({
      query: params.worktree !== undefined ? { worktree: params.worktree } : {},
    });
    if (!res.ok) throw new Error(`GET /api/inbox failed: ${res.status}`);
    return v.parse(InboxResponseSchema, await res.json());
  },
};

export const configApi = {
  async get(): Promise<ClientConfig> {
    const res = await client.api.config.$get();
    if (!res.ok) throw new Error(`GET /api/config failed: ${res.status}`);
    return v.parse(ClientConfigSchema, await res.json());
  },
};

export const healthApi = {
  /** 設定ダイアログの接続情報（ui-redesign.md §5.5 D8）用。 */
  async get(): Promise<Health> {
    const res = await client.api.health.$get();
    if (!res.ok) throw new Error(`GET /api/health failed: ${res.status}`);
    return v.parse(HealthSchema, await res.json());
  },
};
