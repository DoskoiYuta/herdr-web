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
      line: "hello",
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
    fetchMock.mockResolvedValueOnce(jsonResponse([{ review: r, line: 3, confidence: "exact" }]));
    const result = await reviewApi.forDiff({
      repo: "/repo/.git",
      from: "HEAD",
      to: "WORKTREE",
      path: "a.txt",
      sideLines: { old: ["a"], new: ["a", "b"] },
    });
    expect(result).toEqual([{ review: r, line: 3, confidence: "exact" }]);
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

  test("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 404));
    await expect(reviewApi.get("missing")).rejects.toThrow(/failed: 404/);
  });
});
