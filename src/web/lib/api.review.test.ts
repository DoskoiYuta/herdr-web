import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Review } from "@contract/review";
import { reviewApi } from "./api";

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: {
      side: "new",
      lines: ["hello"],
      before: [],
      after: [],
      lineHint: 1,
      hash: "deadbeef",
    },
    createdAtHead: "abc123",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [
      {
        seq: 0,
        author: "user",
        body: "please fix",
        at: "2026-09-03T00:00:00.000Z",
        agentSession: null,
        draft: false,
      },
    ],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reviewApi", () => {
  test("list() GETs /api/review with the query and parses an array of Review", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(jsonResponse([r]));
    const result = await reviewApi.list({ repo: "/repo/.git", worktree: "/repo", all: true });
    expect(result).toEqual([r]);
    const url = fetchMock.mock.calls[0]![0] as URL | string;
    const href = url instanceof URL ? url.toString() : String(url);
    expect(href).toContain("/api/review?");
    expect(href).toContain("worktree=%2Frepo");
    expect(href).toContain("all=true");
  });

  test("get() GETs /api/review/:id and parses a Review", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(jsonResponse(r));
    const result = await reviewApi.get(r.id);
    expect(result).toEqual(r);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain(`/api/review/${r.id}`);
  });

  test("forDiff() POSTs /api/review/for-diff with the body and parses matches", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ review: r, line: 3, span: 1, confidence: "exact" }]),
    );
    const result = await reviewApi.forDiff({
      repo: "/repo/.git",
      from: "HEAD",
      to: "WORKTREE",
      path: "a.txt",
      sideLines: { old: ["a"], new: ["a", "b"] },
    });
    expect(result).toEqual([{ review: r, line: 3, span: 1, confidence: "exact" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/review/for-diff");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toMatchObject({ path: "a.txt" });
  });

  test("create() POSTs /api/review and parses the created Review", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(jsonResponse(r, 201));
    const result = await reviewApi.create({
      repo: r.repo,
      worktreeRoot: r.worktreeRoot,
      target: r.target,
      path: r.path,
      anchor: r.anchor,
      createdAtHead: r.createdAtHead,
      viewedAs: r.viewedAs,
      body: "please fix",
    });
    expect(result).toEqual(r);
  });

  test("reply() POSTs /api/review/:id/reply", async () => {
    const r = review({ status: "replied" });
    fetchMock.mockResolvedValueOnce(jsonResponse(r));
    const result = await reviewApi.reply(r.id, { body: "done", author: "agent" });
    expect(result).toEqual(r);
  });

  test("resolve() POSTs /api/review/:id/resolve", async () => {
    const r = review({ status: "resolved" });
    fetchMock.mockResolvedValueOnce(jsonResponse(r));
    const result = await reviewApi.resolve(r.id);
    expect(result).toEqual(r);
  });

  test("reanchor() POSTs /api/review/:id/reanchor", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(jsonResponse(r));
    const result = await reviewApi.reanchor(r.id);
    expect(result).toEqual(r);
  });

  test("notify() POSTs /api/review/:id/notify", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await reviewApi.notify("some-id");
    expect(result).toEqual({ ok: true });
  });

  test("counts() GETs /api/review/counts with repo/worktree and parses the response", async () => {
    const body = {
      byCommit: { abc: { unresolved: 1, drafts: 0 } },
      worktree: { unresolved: 0, drafts: 2 },
      pendingDrafts: 2,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const result = await reviewApi.counts({ repo: "/repo/.git", worktree: "/repo" });
    expect(result).toEqual(body);
    const href = String(fetchMock.mock.calls[0]![0]);
    expect(href).toContain("/api/review/counts?");
    expect(href).toContain("worktree=%2Frepo");
  });

  test("send() POSTs /api/review/send with repo/worktreeRoot and parses the sent reviews", async () => {
    const r = review({ status: "open" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ reviews: [r] }));
    const result = await reviewApi.send({ repo: "/repo/.git", worktreeRoot: "/repo" });
    expect(result).toEqual({ reviews: [r] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/review/send");
    expect(JSON.parse(init!.body as string)).toEqual({ repo: "/repo/.git", worktreeRoot: "/repo" });
  });

  test("editDraft() PUTs /api/review/:id/draft/:seq with the body and parses the updated Review", async () => {
    const r = review();
    fetchMock.mockResolvedValueOnce(jsonResponse(r));
    const result = await reviewApi.editDraft(r.id, 0, "edited");
    expect(result).toEqual(r);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/api/review/${r.id}/draft/0`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual({ body: "edited" });
  });

  test("deleteDraft() DELETEs /api/review/:id/draft/:seq and parses { deleted, review }", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true, review: null }));
    const result = await reviewApi.deleteDraft("r1", 0);
    expect(result).toEqual({ deleted: true, review: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/review/r1/draft/0");
    expect(init?.method).toBe("DELETE");
  });

  test("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 404));
    await expect(reviewApi.get("missing")).rejects.toThrow(/failed: 404/);
  });
});
