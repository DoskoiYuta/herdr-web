import { vValidator } from "@hono/valibot-validator";
import { Hono, type Context } from "hono";
import {
  CreateReviewRequestSchema,
  EditDraftRequestSchema,
  ForDiffRequestSchema,
  ListReviewQuerySchema,
  ReanchorRequestSchema,
  ReplyRequestSchema,
  RepoMoveRequestSchema,
  ReviewCountsQuerySchema,
  SendDraftsRequestSchema,
  type Review,
  type ReviewStatus,
} from "../../contract/review";
import { stripDraftsForAgent } from "../review/domain/visibility";
import type { UsecaseError } from "../review/usecases/errors";
import type { NotifyScheduler } from "../review/usecases/notify-scheduler";
import type { countsUsecase } from "../review/usecases/counts";
import type { createReviewUsecase } from "../review/usecases/create-review";
import type { deleteDraftUsecase } from "../review/usecases/delete-draft";
import type { editDraftUsecase } from "../review/usecases/edit-draft";
import type { forDiffUsecase } from "../review/usecases/for-diff";
import type { listVisibleUsecase } from "../review/usecases/list-visible";
import type { reanchorReviewUsecase } from "../review/usecases/reanchor-review";
import type { reassignRepoUsecase } from "../review/usecases/reassign-repo";
import type { replyToReviewUsecase } from "../review/usecases/reply-to-review";
import type { resolveReviewUsecase } from "../review/usecases/resolve-review";
import type { sendDraftsUsecase } from "../review/usecases/send-drafts";
import type { ReviewRepository } from "../review/ports";

export type ReviewRoutesDeps = {
  repository: ReviewRepository;
  createReview: ReturnType<typeof createReviewUsecase>;
  replyToReview: ReturnType<typeof replyToReviewUsecase>;
  resolveReview: ReturnType<typeof resolveReviewUsecase>;
  listVisible: ReturnType<typeof listVisibleUsecase>;
  forDiff: ReturnType<typeof forDiffUsecase>;
  reanchorReview: ReturnType<typeof reanchorReviewUsecase>;
  editDraft: ReturnType<typeof editDraftUsecase>;
  deleteDraft: ReturnType<typeof deleteDraftUsecase>;
  sendDrafts: ReturnType<typeof sendDraftsUsecase>;
  counts: ReturnType<typeof countsUsecase>;
  notifyScheduler: NotifyScheduler;
};

export type RepoRoutesDeps = {
  reassignRepo: ReturnType<typeof reassignRepoUsecase>;
};

function mapUsecaseError(c: Context, error: UsecaseError) {
  if (error.type === "not_found") return c.json({ error: error.message, type: error.type }, 404);
  if (error.type === "invalid_rev") return c.json({ error: error.message, type: error.type }, 400);
  if (error.type === "already_exists")
    return c.json({ error: error.message, type: error.type }, 409);
  if (error.type === "ambiguous_target")
    return c.json({ error: error.message, type: error.type, targets: error.targets }, 409);
  return c.json({ error: error.message, type: error.type }, 409);
}

/** agent 向け（`drafts` 未指定）は下書きを落とし、空になった review は結果から除く */
function visibleReviews(reviews: Review[], includeDrafts: boolean): Review[] {
  if (includeDrafts) return reviews;
  return reviews.flatMap((r) => {
    const stripped = stripDraftsForAgent(r);
    return stripped ? [stripped] : [];
  });
}

const FULL_ID_LENGTH = 36; // Bun.randomUUIDv7() の長さ（ハイフン込み）
const MIN_SHORT_ID_LENGTH = 4;

type FindByIdResult =
  | { kind: "found"; review: Review }
  | { kind: "not_found" }
  | { kind: "ambiguous" };

/**
 * `GET /:id` の id はハイフン込みの完全な uuid か、その末尾一致（4 文字以上）を受け付ける。
 * UUIDv7 の先頭はタイムスタンプなので近い時刻に作られた id は先頭 8 文字が揃ってしまう。
 * 末尾はランダムビットなので、`hw review list` が出す短縮 id は末尾側を使う。
 */
async function findReviewByIdOrSuffix(
  repository: ReviewRepository,
  id: string,
  includeDrafts: boolean,
): Promise<FindByIdResult> {
  const visible = (review: Review) => (includeDrafts ? review : stripDraftsForAgent(review));
  if (id.length >= FULL_ID_LENGTH) {
    const review = await repository.get(id);
    const seen = review && visible(review);
    return seen ? { kind: "found", review: seen } : { kind: "not_found" };
  }
  if (id.length < MIN_SHORT_ID_LENGTH) return { kind: "not_found" };

  // 一意性は呼び出し側に見える review の中で判定する。agent には見えない下書きだけの
  // review が末尾を共有していても、agent が長い id を知る手段は無い。
  const all = await repository.list({});
  const matches = all.flatMap((r) => {
    if (!r.id.endsWith(id)) return [];
    const seen = visible(r);
    return seen ? [seen] : [];
  });
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "found", review: matches[0]! };
}

/**
 * plan §9.4 の Hono RPC — review。deviation:
 *  - `GET /api/review/for-diff` は `POST /api/review/for-diff` にした。クライアントは既にパース済みの
 *    diff 行を持っているため、`sideLines` を body で送る（GET で配列を渡すのは煩雑なため）。
 *  - `GET /api/hw/whoami` はここには含まない（herdr 連携は別モジュールの責務）。
 *  - `resolve` に author は取らない（user 専用。ルートで agent には出さない）。
 *  - `/counts` と `/send` は `/:id` より前に登録する（`/:id` に食われないように）。
 */
export function reviewRoutes(deps: ReviewRoutesDeps) {
  const app = new Hono()
    .get("/", vValidator("query", ListReviewQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const includeDrafts = query.drafts ?? false;

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
        return result.match(
          (reviews) => c.json(visibleReviews(reviews, includeDrafts)),
          (error) => mapUsecaseError(c, error),
        );
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
      return c.json(visibleReviews(reviews, includeDrafts));
    })
    .get("/counts", vValidator("query", ReviewCountsQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const result = await deps.counts({ repo: query.repo, worktree: query.worktree });
      return result.match(
        (counts) => c.json(counts),
        (error) => mapUsecaseError(c, error),
      );
    })
    .post("/for-diff", vValidator("json", ForDiffRequestSchema), async (c) => {
      const result = await deps.forDiff(c.req.valid("json"));
      return c.json(result._unsafeUnwrap());
    })
    .post("/send", vValidator("json", SendDraftsRequestSchema), async (c) => {
      const result = await deps.sendDrafts(c.req.valid("json"));
      return result.match(
        (value) => c.json(value),
        (error) => mapUsecaseError(c, error),
      );
    })
    .post("/", vValidator("json", CreateReviewRequestSchema), async (c) => {
      const result = await deps.createReview(c.req.valid("json"));
      return c.json(result._unsafeUnwrap(), 201);
    })
    .get("/:id", async (c) => {
      const id = c.req.param("id");
      const includeDrafts = c.req.query("drafts") === "true" || c.req.query("drafts") === "1";
      const found = await findReviewByIdOrSuffix(deps.repository, id, includeDrafts);
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "review not found" }, 404);
      }
      return c.json(found.review);
    })
    .post("/:id/reply", vValidator("json", ReplyRequestSchema), async (c) => {
      const body = c.req.valid("json");
      const found = await findReviewByIdOrSuffix(
        deps.repository,
        c.req.param("id"),
        body.author === "user",
      );
      if (found.kind === "ambiguous") {
        return c.json({ error: "ambiguous id", type: "ambiguous" }, 409);
      }
      if (found.kind === "not_found") {
        return c.json({ error: "review not found", type: "not_found" }, 404);
      }
      const result = await deps.replyToReview({ id: found.review.id, ...body });
      return result.match(
        (review) => {
          // agent の返信直後は必ず送信済みエントリがあるので stripDraftsForAgent は null にならない
          const visible = body.author === "agent" ? stripDraftsForAgent(review) : review;
          return c.json(visible ?? review);
        },
        (error) => mapUsecaseError(c, error),
      );
    })
    .put("/:id/draft/:seq", vValidator("json", EditDraftRequestSchema), async (c) => {
      const id = c.req.param("id");
      const seq = Number(c.req.param("seq"));
      const body = c.req.valid("json");
      const result = await deps.editDraft({ id, seq, body: body.body });
      return result.match(
        (review) => c.json(review),
        (error) => mapUsecaseError(c, error),
      );
    })
    .delete("/:id/draft/:seq", async (c) => {
      const id = c.req.param("id");
      const seq = Number(c.req.param("seq"));
      const result = await deps.deleteDraft({ id, seq });
      return result.match(
        (outcome) => c.json(outcome),
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
    return result.match(
      (counts) => c.json(counts),
      (error) => mapUsecaseError(c, error),
    );
  });

  return app;
}

export type RepoRoutesType = ReturnType<typeof repoRoutes>;
