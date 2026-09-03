import { vValidator } from "@hono/valibot-validator";
import { Hono, type Context } from "hono";
import {
  CreateReviewRequestSchema,
  ForDiffRequestSchema,
  ListReviewQuerySchema,
  ReanchorRequestSchema,
  ReplyRequestSchema,
  RepoMoveRequestSchema,
  type ReviewStatus,
} from "../../contract/review";
import type { UsecaseError } from "../review/usecases/errors";
import type { NotifyScheduler } from "../review/usecases/notify-scheduler";
import type { createReviewUsecase } from "../review/usecases/create-review";
import type { forDiffUsecase } from "../review/usecases/for-diff";
import type { listVisibleUsecase } from "../review/usecases/list-visible";
import type { reanchorReviewUsecase } from "../review/usecases/reanchor-review";
import type { reassignRepoUsecase } from "../review/usecases/reassign-repo";
import type { replyToReviewUsecase } from "../review/usecases/reply-to-review";
import type { resolveReviewUsecase } from "../review/usecases/resolve-review";
import type { ReviewRepository } from "../review/ports";

export type ReviewRoutesDeps = {
  repository: ReviewRepository;
  createReview: ReturnType<typeof createReviewUsecase>;
  replyToReview: ReturnType<typeof replyToReviewUsecase>;
  resolveReview: ReturnType<typeof resolveReviewUsecase>;
  listVisible: ReturnType<typeof listVisibleUsecase>;
  forDiff: ReturnType<typeof forDiffUsecase>;
  reanchorReview: ReturnType<typeof reanchorReviewUsecase>;
  notifyScheduler: NotifyScheduler;
};

export type RepoRoutesDeps = {
  reassignRepo: ReturnType<typeof reassignRepoUsecase>;
};

function mapUsecaseError(c: Context, error: UsecaseError) {
  if (error.type === "not_found") return c.json({ error: error.message, type: error.type }, 404);
  return c.json({ error: error.message, type: error.type }, 409);
}

/**
 * plan §9.4 の Hono RPC — review。deviation:
 *  - `GET /for-diff` は `POST /for-diff` にした。クライアントは既にパース済みの
 *    diff 行を持っているため、`sideLines` を body で送る（GET で配列を渡すのは煩雑なため）。
 *  - `GET /api/hw/whoami` はここには含まない（herdr 連携は別モジュールの責務）。
 *  - `resolve` に author は取らない（user 専用。ルートで agent には出さない）。
 */
export function reviewRoutes(deps: ReviewRoutesDeps) {
  const app = new Hono()
    .get("/", vValidator("query", ListReviewQuerySchema), async (c) => {
      const query = c.req.valid("query");

      if (query.worktree) {
        if (!query.repo) {
          return c.json({ error: "repo is required when worktree is given" }, 400);
        }
        const result = await deps.listVisible({
          repo: query.repo,
          worktreeRoot: query.worktree,
          opts: {
            all: query.all,
            commit: query.commit,
            since: query.since,
            uncommitted: query.uncommitted,
            unreachable: query.unreachable,
            path: query.path,
          },
        });
        return c.json(result._unsafeUnwrap());
      }

      const status = query.status
        ? (query.status.split(",").filter(Boolean) as ReviewStatus[])
        : undefined;
      const reviews = await deps.repository.list({
        repo: query.repo,
        status,
        commit: query.commit,
        path: query.path,
      });
      return c.json(reviews);
    })
    .post("/for-diff", vValidator("json", ForDiffRequestSchema), async (c) => {
      const result = await deps.forDiff(c.req.valid("json"));
      return c.json(result._unsafeUnwrap());
    })
    .post("/", vValidator("json", CreateReviewRequestSchema), async (c) => {
      const result = await deps.createReview(c.req.valid("json"));
      return c.json(result._unsafeUnwrap(), 201);
    })
    .get("/:id", async (c) => {
      const review = await deps.repository.get(c.req.param("id"));
      if (!review) return c.json({ error: "review not found" }, 404);
      return c.json(review);
    })
    .post("/:id/reply", vValidator("json", ReplyRequestSchema), async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const result = await deps.replyToReview({ id, ...body });
      return result.match(
        (review) => c.json(review),
        (error) => mapUsecaseError(c, error),
      );
    })
    .post("/:id/resolve", async (c) => {
      const result = await deps.resolveReview(c.req.param("id"));
      return result.match(
        (review) => c.json(review),
        (error) => mapUsecaseError(c, error),
      );
    })
    .post("/:id/reanchor", vValidator("json", ReanchorRequestSchema), async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const result = await deps.reanchorReview({ id, head: body.head });
      return result.match(
        (review) => c.json(review),
        (error) => mapUsecaseError(c, error),
      );
    })
    .post("/:id/notify", async (c) => {
      const id = c.req.param("id");
      const review = await deps.repository.get(id);
      if (!review) return c.json({ error: "review not found" }, 404);
      await deps.notifyScheduler.resend(id);
      return c.json({ ok: true });
    });

  return app;
}

export type ReviewRoutesType = ReturnType<typeof reviewRoutes>;

/** plan §9.4: `POST /api/repo/move`。`reviewRoutes` とは別に export し、`/api/repo` 配下に mount する想定 */
export function repoRoutes(deps: RepoRoutesDeps) {
  const app = new Hono().post("/move", vValidator("json", RepoMoveRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await deps.reassignRepo(body);
    return c.json(result._unsafeUnwrap());
  });

  return app;
}

export type RepoRoutesType = ReturnType<typeof repoRoutes>;
