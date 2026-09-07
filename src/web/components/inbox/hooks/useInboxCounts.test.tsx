import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { makeFakeStore } from "@/testing/renderWithRouter";
import { useInboxCounts } from "./useInboxCounts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <HerdrStoreProvider store={makeFakeStore()}>{children}</HerdrStoreProvider>
    </QueryClientProvider>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
});

// 無いと壊れる: バッジが読み込み前に 0 件と表示してしまうと、実際は件数不明なのに
// 「対応不要」と誤って伝わる。
test("returns null before the aggregation query resolves", () => {
  fetchMock = vi.fn(() => new Promise(() => {})); // never resolves
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useInboxCounts(), { wrapper });
  expect(result.current.data).toBeNull();
});

// 無いと壊れる: 集約 API の counts.total が使われていないと、サイドバー/アイコン
// レールのバッジが常に非表示のままになる。
test("returns counts.total once the aggregation query resolves", async () => {
  fetchMock = vi.fn(async () => jsonResponse({ items: [], counts: { total: 3, bySection: {} } }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useInboxCounts(), { wrapper });
  await waitFor(() => expect(result.current.data).toBe(3));
});
