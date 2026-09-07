import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Ask, CreateAskRequest } from "@contract/ask";
import { askApi, AskUnknownAgentError } from "./api";

function ask(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: { side: "new", lines: ["hello"], before: [], after: [], lineHint: 1, hash: "deadbeef" },
    createdAtHead: "abc123",
    status: "open",
    session: { kind: "herdr", label: "ask:abc12345", agent: "claude" },
    thread: [
      { seq: 0, author: "user", body: "why?", at: "2026-09-05T00:00:00.000Z", agentSession: null },
    ],
    lastPrompt: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
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

const createBody: CreateAskRequest = {
  repo: "/repo/.git",
  worktreeRoot: "/repo",
  path: "a.txt",
  anchor: { side: "new", lines: ["hello"], before: [], after: [], lineHint: 1, hash: "deadbeef" },
  createdAtHead: "abc123",
  body: "why?",
  target: { kind: "new", agent: "gpt4" },
};

describe("askApi.create", () => {
  // 無いと壊れる: 400 unknown_agent が汎用の Error として投げられると、送信先
  // ダイアログが他の理由（herdr 未接続など）と区別してエラーを出し分けられない。
  test("throws AskUnknownAgentError with the allowed agents on 400 unknown_agent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "unknown_agent", agents: ["claude", "codex"] }, 400),
    );
    await expect(askApi.create(createBody)).rejects.toThrow(AskUnknownAgentError);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "unknown_agent", agents: ["claude", "codex"] }, 400),
    );
    const err = await askApi
      .create(createBody)
      .then(() => null)
      .catch((e: unknown) => e as AskUnknownAgentError);
    expect(err?.agents).toEqual(["claude", "codex"]);
  });
});

describe("askApi.list", () => {
  test("GETs /api/ask with the query and parses an array of Ask", async () => {
    const a = ask();
    fetchMock.mockResolvedValueOnce(jsonResponse([a]));
    const result = await askApi.list({ repo: "/repo/.git", status: "open,replied,outdated" });
    expect(result).toEqual([a]);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/ask?");
    expect(url).toContain("repo=%2Frepo%2F.git");
    expect(url).toContain("status=open%2Creplied%2Coutdated");
  });
});
