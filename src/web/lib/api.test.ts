import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CommandFailedError,
  CommandTimeoutError,
  CommandUnavailableError,
  dockerApi,
  FetchBusyError,
  gitApi,
  procApi,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gitApi.subrepos", () => {
  test("parses a response with root + submodule + vcstool repos", async () => {
    const worktrees = [{ root: "/repo", branch: "main", head: "abc123", isMain: true }];
    const repos = [
      { id: "", name: "project", root: "/repo", kind: "root" as const, worktrees },
      {
        id: "vendor/lib",
        name: "lib",
        root: "/repo/vendor/lib",
        kind: "submodule" as const,
        worktrees,
      },
      {
        id: ".repos/nested-a",
        name: "nested-a",
        root: "/repo/.repos/nested-a",
        kind: "vcs" as const,
        worktrees,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repos }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gitApi.subrepos("/repo");

    expect(result).toEqual({ repos });
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/api/git/subrepos");
    expect(calledUrl).toContain("repo=%2Frepo");
  });

  test("throws on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gitApi.subrepos("/repo")).rejects.toThrow("403");
  });

  test("throws when the response fails schema validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ repos: [{ id: "", name: "project", root: "/repo", kind: "bogus" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gitApi.subrepos("/repo")).rejects.toThrow();
  });
});

describe("gitApi.fetch", () => {
  test("posts to /api/git/fetch and parses the result", async () => {
    const result = {
      code: 0,
      stdout: "From origin\n",
      stderr: "",
      durationMs: 123,
      timedOut: false,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    const body = await gitApi.fetch("/repo");

    expect(body).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/git/fetch");
    expect(String(url)).toContain("repo=%2Frepo");
    expect(init).toMatchObject({ method: "POST" });
  });

  test("a non-zero code / timed-out result still resolves (never throws)", async () => {
    const result = { code: -1, stdout: "", stderr: "killed", durationMs: 120000, timedOut: true };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gitApi.fetch("/repo")).resolves.toEqual(result);
  });

  test("409 throws FetchBusyError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "busy" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gitApi.fetch("/repo")).rejects.toBeInstanceOf(FetchBusyError);
  });

  test("other non-ok statuses throw a generic error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(gitApi.fetch("/repo")).rejects.toThrow("403");
  });
});

describe.each([
  ["dockerApi.containers", () => dockerApi.containers("/repo"), { groups: [] }],
  ["procApi.list", () => procApi.list("/repo"), { processes: [] }],
])("%s", (_label, call, body) => {
  test("parses a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
    );

    await expect(call()).resolves.toEqual(body);
  });

  test("501 throws CommandUnavailableError (binary missing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 501,
        json: async () => ({ error: "command-missing" }),
      }),
    );

    await expect(call()).rejects.toBeInstanceOf(CommandUnavailableError);
  });

  test("503 throws CommandFailedError carrying the server's stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "command-failed", message: "boom" }),
      }),
    );

    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandFailedError);
    expect((err as CommandFailedError).detail).toBe("boom");
  });

  test("504 throws CommandTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 504, json: async () => ({ error: "timeout" }) }),
    );

    await expect(call()).rejects.toBeInstanceOf(CommandTimeoutError);
  });
});
