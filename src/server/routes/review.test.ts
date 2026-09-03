import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../contract/review";
import {
  FakeAgentNotifier,
  FakeGitHistory,
  FakeIntroducingCommitFinder,
  FakeReviewEvents,
  FakeWorktreeFileReader,
  ManualClock,
  ManualTimer,
} from "../review/testing/fakes";
import { createSqliteReviewRepository } from "../review/adapters/sqlite-repository";
import { createReviewUsecase } from "../review/usecases/create-review";
import { forDiffUsecase } from "../review/usecases/for-diff";
import { listVisibleUsecase } from "../review/usecases/list-visible";
import { createNotifyScheduler } from "../review/usecases/notify-scheduler";
import { reanchorReviewUsecase } from "../review/usecases/reanchor-review";
import { reassignRepoUsecase } from "../review/usecases/reassign-repo";
import { replyToReviewUsecase } from "../review/usecases/reply-to-review";
import { resolveReviewUsecase } from "../review/usecases/resolve-review";
import { openDb, type Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { repoRoutes, reviewRoutes } from "./review";

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

/** `Response#json()` is typed `unknown`; this narrows it for test assertions only */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

function buildApp() {
  const db: Db = openDb(":memory:");
  applyMigrations(db);
  const repository = createSqliteReviewRepository(db);
  const clock = new ManualClock("2026-01-01T00:00:00.000Z");
  const events = new FakeReviewEvents();
  const notifier = new FakeAgentNotifier();
  const timer = new ManualTimer();
  const gitHistory = new FakeGitHistory();
  const fileReader = new FakeWorktreeFileReader();
  const finder = new FakeIntroducingCommitFinder();

  const notifyScheduler = createNotifyScheduler({
    notifier,
    events,
    repository,
    clock,
    timer,
    debounceMs: 10_000,
  });

  const app = reviewRoutes({
    repository,
    createReview: createReviewUsecase({
      repository,
      events,
      clock,
      scheduleNotify: (review) => notifyScheduler.schedule(review),
      generateId: () => "generated-id",
    }),
    replyToReview: replyToReviewUsecase({ repository, events, clock }),
    resolveReview: resolveReviewUsecase({ repository, events, clock }),
    listVisible: listVisibleUsecase({ repository, gitHistory }),
    forDiff: forDiffUsecase({ repository }),
    reanchorReview: reanchorReviewUsecase({
      repository,
      fileReader,
      finder,
      gitHistory,
      clock,
      events,
    }),
    notifyScheduler,
  });

  const repoApp = repoRoutes({ reassignRepo: reassignRepoUsecase({ repository }) });

  return { app, repoApp, repository, notifier, timer, events, gitHistory };
}

const CREATE_BODY = {
  repo: "/repo/.git",
  worktreeRoot: "/repo",
  target: { kind: "worktree", root: "/repo" },
  path: "a.ts",
  anchor: ANCHOR,
  createdAtHead: "head1",
  viewedAs: { from: "WORKTREE", to: "WORKTREE" },
  body: "why?",
};

describe("reviewRoutes", () => {
  test("POST / creates a review, returns 201, and schedules a notification", async () => {
    const { app, notifier, timer } = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.id).toBe("generated-id");
    expect(body.status).toBe("open");

    timer.advance(10_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(notifier.calls).toHaveLength(1);
  });

  test("POST / with an invalid body returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "/repo" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /:id returns the created review, 404 when missing", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const ok = await app.request("/generated-id");
    expect(ok.status).toBe(200);

    const missing = await app.request("/nope");
    expect(missing.status).toBe(404);
  });

  test("GET / without worktree lists by repo filter", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await app.request("/?repo=/repo/.git");
    expect(res.status).toBe(200);
    const rows = await json(res);
    expect(rows).toHaveLength(1);
  });

  test("GET / with worktree but no repo returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/?worktree=/repo");
    expect(res.status).toBe(400);
  });

  test("GET / with worktree uses listVisible", async () => {
    const { app, gitHistory } = buildApp();
    gitHistory.heads.set("/repo", "head1");
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await app.request("/?repo=/repo/.git&worktree=/repo");
    expect(res.status).toBe(200);
    const rows = await json(res);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("generated-id");
  });

  test("reply -> resolve -> reply(user reopen) transition round trip via HTTP", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const replied = await app.request("/generated-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "agent", body: "done" }),
    });
    expect(replied.status).toBe(200);
    expect((await json(replied)).status).toBe("replied");

    const resolved = await app.request("/generated-id/resolve", { method: "POST" });
    expect(resolved.status).toBe(200);
    expect((await json(resolved)).status).toBe("resolved");

    const alreadyResolved = await app.request("/generated-id/resolve", { method: "POST" });
    expect(alreadyResolved.status).toBe(409);

    const reopened = await app.request("/generated-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "user", body: "reopen please" }),
    });
    expect(reopened.status).toBe(200);
    expect((await json(reopened)).status).toBe("open");
  });

  test("reply on a resolved review by an agent returns 409", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });
    await app.request("/generated-id/resolve", { method: "POST" });

    const res = await app.request("/generated-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "agent", body: "x" }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.type).toBe("not_repliable");
  });

  test("reply on an unknown id returns 404", async () => {
    const { app } = buildApp();
    const res = await app.request("/nope/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "user", body: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /for-diff returns anchor matches for the current diff lines", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await app.request("/for-diff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: "/repo/.git",
        worktreeRoot: "/repo",
        from: "HEAD",
        to: "WORKTREE",
        path: "a.ts",
        sideLines: { old: [], new: ["x"] },
      }),
    });
    expect(res.status).toBe(200);
    const matches = await json(res);
    expect(matches).toHaveLength(1);
    expect(matches[0].review.id).toBe("generated-id");
  });

  test("POST /:id/reanchor applies a manual reanchor", async () => {
    const { app } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await app.request("/generated-id/reanchor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    // no fileReader entry registered -> file "gone" -> outdated
    expect((await json(res)).status).toBe("outdated");
  });

  test("POST /:id/notify resends immediately, bypassing debounce", async () => {
    const { app, notifier } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await app.request("/generated-id/notify", { method: "POST" });
    expect(res.status).toBe(200);
    expect(notifier.calls).toHaveLength(1);
  });
});

describe("repoRoutes", () => {
  test("POST /move rewrites repo and review paths by prefix", async () => {
    const { app, repoApp, repository } = buildApp();
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CREATE_BODY),
    });

    const res = await repoApp.request("/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "/repo", to: "/new/repo" }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ repos: 1, reviews: 1 });

    const review = await repository.get("generated-id");
    expect(review?.worktreeRoot).toBe("/new/repo");
  });
});
