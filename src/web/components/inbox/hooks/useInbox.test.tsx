import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { makeFakeStore, type FakeHerdrStore } from "@/testing/renderWithRouter";
import { useInbox } from "./useInbox";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const emptyInbox = { items: [], counts: { total: 0, bySection: {} } };

function wrapper(client: QueryClient, store: FakeHerdrStore) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <HerdrStoreProvider store={store}>{children}</HerdrStoreProvider>
      </QueryClientProvider>
    );
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(emptyInbox));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetches GET /api/inbox and returns the parsed response", async () => {
  const client = new QueryClient();
  const store = makeFakeStore();
  const { result } = renderHook(() => useInbox(), { wrapper: wrapper(client, store) });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual(emptyInbox);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

describe("refetches on invalidating signals", () => {
  test.each([
    [
      "a review event",
      (store: FakeHerdrStore) =>
        store.emitReview({ type: "review", event: "created", review: {} as never }),
    ],
    [
      "an ask event",
      (store: FakeHerdrStore) =>
        store.emitAsk({ type: "ask", action: "created", ask: {} as never }),
    ],
    [
      "a decision event",
      (store: FakeHerdrStore) =>
        store.emitDecision({
          type: "decision",
          action: "created",
          id: "d1",
          worktreeRoot: null,
          paneId: null,
        }),
    ],
    // 無いと壊れる: blocked pane や pane の worktree 解決の変化は review/ask/decision
    // イベントを一切出さないため、tree の参照変化を見ていないと Inbox が更新されない。
    [
      "a herdr tree change (repos reference)",
      (store: FakeHerdrStore) => store.setState({ repos: [] }),
    ],
  ] as const)("%s triggers a refetch", async (_label, trigger) => {
    const client = new QueryClient();
    const store = makeFakeStore();
    const { result } = renderHook(() => useInbox(), { wrapper: wrapper(client, store) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    trigger(store);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

test("passes the worktree filter through to the request query", async () => {
  const client = new QueryClient();
  const store = makeFakeStore();
  renderHook(() => useInbox("/repo-a"), { wrapper: wrapper(client, store) });

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const url = new URL(fetchMock.mock.calls[0]![0] as string);
  expect(url.searchParams.get("worktree")).toBe("/repo-a");
});
