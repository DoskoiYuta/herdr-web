import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePatch } from "./usePatch.ts";

function patchResponseBody(hash: string) {
  return {
    patch: "",
    hash,
    generatedAt: "2026-09-03T00:00:00.000Z",
    files: [],
    untrackedCount: 0,
    untrackedTruncated: false,
    untrackedErrors: 0,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(patchResponseBody("h1")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetches the patch via gitApi.patch and returns a validated PatchResponse", async () => {
  const client = new QueryClient();
  const { result } = renderHook(() => usePatch({ repo: "/repo", repoChangedTick: 0 }), {
    wrapper: wrapper(client),
  });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.hash).toBe("h1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("does not refetch on the tick value the hook mounted with", async () => {
  const client = new QueryClient();
  const { result } = renderHook(() => usePatch({ repo: "/repo", repoChangedTick: 5 }), {
    wrapper: wrapper(client),
  });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("refetches when repoChangedTick changes", async () => {
  const client = new QueryClient();
  const { result, rerender } = renderHook(
    ({ tick }) => usePatch({ repo: "/repo", repoChangedTick: tick }),
    {
      wrapper: wrapper(client),
      initialProps: { tick: 0 },
    },
  );

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockImplementation(async () => jsonResponse(patchResponseBody("h2")));
  act(() => rerender({ tick: 1 }));

  await waitFor(() => expect(result.current.data?.hash).toBe("h2"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("staleTime Infinity means switching repo/from/to keys does not refetch an already-cached key", async () => {
  const client = new QueryClient();
  const { result, rerender } = renderHook(
    ({ repo }: { repo: string }) => usePatch({ repo, repoChangedTick: 0 }),
    { wrapper: wrapper(client), initialProps: { repo: "/repo-a" } },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  rerender({ repo: "/repo-b" });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  rerender({ repo: "/repo-a" });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  // Cached under staleTime: Infinity — no third fetch for the already-seen key.
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
