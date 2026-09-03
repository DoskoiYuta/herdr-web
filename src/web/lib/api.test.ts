import { afterEach, describe, expect, test, vi } from "vitest";
import { gitApi } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gitApi.subrepos", () => {
  test("parses a response with root + submodule + nested repos", async () => {
    const repos = [
      { id: "", name: "project", root: "/repo", kind: "root" as const },
      { id: "vendor/lib", name: "lib", root: "/repo/vendor/lib", kind: "submodule" as const },
      {
        id: ".repos/nested-a",
        name: "nested-a",
        root: "/repo/.repos/nested-a",
        kind: "nested" as const,
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
