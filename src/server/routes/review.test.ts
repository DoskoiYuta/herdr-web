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
import { countsUsecase } from "../review/usecases/counts";
import { createReviewUsecase } from "../review/usecases/create-review";
import { deleteDraftUsecase } from "../review/usecases/delete-draft";
import { editDraftUsecase } from "../review/usecases/edit-draft";
import { forDiffUsecase } from "../review/usecases/for-diff";
import { listVisibleUsecase } from "../review/usecases/list-visible";
import { createNotifyScheduler } from "../review/usecases/notify-scheduler";
import { reanchorReviewUsecase } from "../review/usecases/reanchor-review";
import { reassignRepoUsecase } from "../review/usecases/reassign-repo";
import { replyToReviewUsecase } from "../review/usecases/reply-to-review";
import { resolveReviewUsecase } from "../review/usecases/resolve-review";
import { sendDraftsUsecase } from "../review/usecases/send-drafts";
import { openDb, type Db } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { repoRoutes, reviewRoutes } from "./review";

const ANCHOR: Anchor = { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" };

/** `Response#json()` is typed `unknown`; this narrows it for test assertions only */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

let nextId = "generated-id";

function buildApp() {
  nextId = "generated-id";
  const db: Db = openDb(":memory:");
  applyMigrations(db);
  const repository = createSqliteReviewRepository(db);
  const clock = new ManualClock("2026-01-01T00:00:00.000Z");
  const events = new FakeReviewEvents();
  const notifier = new FakeAgentNotifier();
  notifier.targets.set("/repo", [{ pane: "pane-1", focused: false }]);
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
  const listVisible = listVisibleUsecase({ repository, gitHistory });

  const app = reviewRoutes({
    repository,
    createReview: createReviewUsecase({
      repository,
      events,
      clock,
      generateId: () => nextId,
    }),
    replyToReview: replyToReviewUsecase({ repository, events, clock }),
    resolveReview: resolveReviewUsecase({ repository, events, clock }),
    listVisible,
    forDiff: forDiffUsecase({ repository }),
    reanchorReview: reanchorReviewUsecase({
      repository,
      fileReader,
      finder,
      gitHistory,
      clock,
      events,
    }),
    editDraft: editDraftUsecase({ repository, events, clock }),
    deleteDraft: deleteDraftUsecase({ repository, events, clock }),
    sendDrafts: sendDraftsUsecase({
      repository,
      events,
      clock,
      notifyScheduler,
      notifier,
      listVisible,
    }),
    counts: countsUsecase({ repository, listVisible }),
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

async function create(app: ReturnType<typeof buildApp>["app"], overrides: object = {}) {
  return app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...CREATE_BODY, ...overrides }),
  });
}

async function sendDrafts(
  app: ReturnType<typeof buildApp>["app"],
  repo = "/repo/.git",
  worktreeRoot = "/repo",
  pane?: string,
) {
  return app.request("/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo, worktreeRoot, ...(pane ? { pane } : {}) }),
  });
}

describe("reviewRoutes", () => {
  test("POST / creates a draft review (201), not yet visible to the agent", async () => {
    const { app } = buildApp();
    const res = await create(app);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.id).toBe("generated-id");
    expect(body.status).toBe("open");
    expect(body.thread[0].draft).toBe(true);
    expect(body.notify.state).toBe("none");

    // agent-facing GET /:id (no drafts=true) can't see a draft-only review
    const getRes = await app.request("/generated-id");
    expect(getRes.status).toBe(404);
  });

  test("GET /:id?drafts=true returns the draft review to the Web UI", async () => {
    const { app } = buildApp();
    await create(app);
    const res = await app.request("/generated-id?drafts=true");
    expect(res.status).toBe(200);
    expect((await json(res)).thread[0].draft).toBe(true);
  });

  test("POST /send marks drafts sent and notifies once", async () => {
    const { app, notifier } = buildApp();
    await create(app);
    const res = await sendDrafts(app);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].thread[0].draft).toBe(false);
    expect(notifier.calls).toHaveLength(1);

    const getRes = await app.request("/generated-id");
    expect(getRes.status).toBe(200);
    expect((await json(getRes)).status).toBe("open");
  });

  test("POST /send with nothing to send returns an empty list", async () => {
    const { app } = buildApp();
    const res = await sendDrafts(app);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ reviews: [] });
  });

  // without this test, sending from a worktree with no agent pane could silently
  // mark drafts sent with nowhere for the notification to go.
  test("POST /send with no agent pane at the worktree returns 409 no_agent and leaves drafts untouched", async () => {
    const { app, notifier } = buildApp();
    notifier.targets.delete("/repo");
    await create(app);

    const res = await sendDrafts(app);
    expect(res.status).toBe(409);
    expect((await json(res)).type).toBe("no_agent");

    const draft = await app.request("/generated-id?drafts=true");
    expect((await json(draft)).thread[0].draft).toBe(true);
  });

  // without this test, sending with two agent panes at the worktree could pick one
  // arbitrarily instead of surfacing the choice to the caller.
  test("POST /send with two agent panes and no pane returns 409 ambiguous_target listing both", async () => {
    const { app, notifier } = buildApp();
    notifier.targets.set("/repo", [
      { pane: "p1", focused: false },
      { pane: "p2", focused: false },
    ]);
    await create(app);

    const res = await sendDrafts(app);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.type).toBe("ambiguous_target");
    expect(body.targets.sort()).toEqual(["p1", "p2"]);
  });

  // without this test, an explicit `pane` from the client could be silently
  // ignored on the way to the notifier.
  test("POST /send with an explicit pane reaches the notifier as that pane", async () => {
    const { app, notifier } = buildApp();
    notifier.targets.set("/repo", [
      { pane: "p1", focused: false },
      { pane: "p2", focused: false },
    ]);
    await create(app);

    const res = await sendDrafts(app, "/repo/.git", "/repo", "p2");
    expect(res.status).toBe(200);
    expect(notifier.calls).toEqual([
      { worktreeRoot: "/repo", reviewIds: ["generated-id"], pane: "p2" },
    ]);
  });

  test("PUT /:id/draft/:seq edits a draft's body", async () => {
    const { app } = buildApp();
    await create(app);
    const res = await app.request("/generated-id/draft/0", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "revised" }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).thread[0].body).toBe("revised");
  });

  test("PUT /:id/draft/:seq on a non-draft entry returns 409 not_draft", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);
    const res = await app.request("/generated-id/draft/0", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "revised" }),
    });
    expect(res.status).toBe(409);
    expect((await json(res)).type).toBe("not_draft");
  });

  test("DELETE /:id/draft/:seq on the only entry deletes the whole review", async () => {
    const { app, repository } = buildApp();
    await create(app);
    const res = await app.request("/generated-id/draft/0", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ deleted: true, review: null });
    expect(await repository.get("generated-id")).toBeNull();
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

  test("GET /:id returns the sent review, 404 when missing", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);

    const ok = await app.request("/generated-id");
    expect(ok.status).toBe(200);

    const missing = await app.request("/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(missing.status).toBe(404);
  });

  test("GET /:id accepts a unique id suffix, 404 when too short", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);
    // a draft-only review the agent cannot see must not make the agent's short id ambiguous
    nextId = "draft-only-generated-id";
    await create(app);

    const bySuffix = await app.request("/d-id");
    expect(bySuffix.status).toBe(200);
    expect((await json(bySuffix)).id).toBe("generated-id");

    const tooShort = await app.request("/-id");
    expect(tooShort.status).toBe(404);
  });

  test("GET / without worktree lists by repo filter (drafts excluded by default)", async () => {
    const { app } = buildApp();
    await create(app);

    const res = await app.request("/?repo=/repo/.git");
    expect(res.status).toBe(200);
    expect(await json(res)).toHaveLength(0); // still a draft, invisible to the agent

    await sendDrafts(app);
    const res2 = await app.request("/?repo=/repo/.git");
    expect(await json(res2)).toHaveLength(1);
  });

  test("GET / with drafts=true includes the draft review", async () => {
    const { app } = buildApp();
    await create(app);
    const res = await app.request("/?repo=/repo/.git&drafts=true");
    expect(await json(res)).toHaveLength(1);
  });

  test("GET / with worktree but no repo returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/?worktree=/repo");
    expect(res.status).toBe(400);
  });

  test("GET / with worktree uses listVisible and excludes drafts by default", async () => {
    const { app, gitHistory } = buildApp();
    gitHistory.heads.set("/repo", "head1");
    await create(app);

    const draftRes = await app.request("/?repo=/repo/.git&worktree=/repo");
    expect(await json(draftRes)).toHaveLength(0);

    await sendDrafts(app);
    const res = await app.request("/?repo=/repo/.git&worktree=/repo");
    expect(res.status).toBe(200);
    const rows = await json(res);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("generated-id");
  });

  test("GET /counts reports byCommit/worktree/pendingDrafts", async () => {
    const { app } = buildApp();
    await create(app);
    const before = await json(await app.request("/counts?repo=/repo/.git&worktree=/repo"));
    expect(before).toEqual({
      byCommit: {},
      worktree: { unresolved: 0, replied: 0, drafts: 1 },
      pendingDrafts: 1,
      replied: { worktree: 0, commit: 0 },
    });

    await sendDrafts(app);
    const after = await json(await app.request("/counts?repo=/repo/.git&worktree=/repo"));
    expect(after).toEqual({
      byCommit: {},
      worktree: { unresolved: 1, replied: 0, drafts: 0 },
      pendingDrafts: 0,
      replied: { worktree: 0, commit: 0 },
    });
  });

  test("reply -> resolve -> reply(user) transition round trip via HTTP", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);

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

    // a user reply after resolve stays a draft — status doesn't reopen until send
    const reopened = await app.request("/generated-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "user", body: "reopen please" }),
    });
    expect(reopened.status).toBe(200);
    expect((await json(reopened)).status).toBe("resolved");

    const sent = await sendDrafts(app);
    const sentBody = await json(sent);
    expect(sentBody.reviews[0].status).toBe("open");
  });

  test("reply on a resolved review by an agent returns 409", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);
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

  test("POST /:id/reply by an agent accepts the short id and never returns draft entries", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);
    // a user draft added after send must stay invisible to the agent's reply response
    await app.request("/generated-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "still thinking", author: "user" }),
    });

    const res = await app.request("/d-id/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "done", author: "agent" }),
    });
    expect(res.status).toBe(200);
    const review = await json(res);
    expect(review.id).toBe("generated-id");
    expect(review.thread.some((e: { draft: boolean }) => e.draft)).toBe(false);
  });

  test("reply on an unknown id returns 404", async () => {
    const { app } = buildApp();
    const res = await app.request("/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "user", body: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /for-diff returns anchor matches (including drafts) for the current diff lines", async () => {
    const { app } = buildApp();
    await create(app);

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
    expect(matches[0].span).toBe(1);
  });

  // F9: an unresolvable `since` rev surfaces as 400, not a silent empty list.
  test("GET / with worktree and an invalid `since` rev returns 400", async () => {
    const { app, gitHistory } = buildApp();
    gitHistory.heads.set("/repo", "head1");
    gitHistory.ranges.set("/repo:not-a-rev~1..head1", null);
    gitHistory.ranges.set("/repo:not-a-rev..head1", null);

    const res = await app.request("/?repo=/repo/.git&worktree=/repo&since=not-a-rev");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.type).toBe("invalid_rev");
  });

  test("POST /:id/reanchor applies a manual reanchor", async () => {
    const { app } = buildApp();
    await create(app);
    await sendDrafts(app);

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
    await create(app);
    await sendDrafts(app);
    notifier.calls.length = 0; // clear the /send notification so we assert only the resend

    const res = await app.request("/generated-id/notify", { method: "POST" });
    expect(res.status).toBe(200);
    expect(notifier.calls).toHaveLength(1);
  });
});

describe("repoRoutes", () => {
  test("POST /move rewrites repo and review paths by prefix", async () => {
    const { app, repoApp, repository } = buildApp();
    await create(app);

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

  // F8: moving onto an already-registered repo key must be rejected, not silently merged.
  test("POST /move onto an existing repo key returns 409", async () => {
    const { app, repoApp } = buildApp();
    await create(app);
    await create(app, {
      repo: "/other/.git",
      worktreeRoot: "/other",
      target: { kind: "worktree", root: "/other" },
    });

    const res = await repoApp.request("/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "/repo/.git", to: "/other/.git" }),
    });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.type).toBe("already_exists");
  });
});
