// M16 レビュー指摘: 設定ダイアログでフォントサイズ/Diff の既定表示を変えても、
// 開いている DiffPanel には反映されなかった（それぞれ独立した useState で
// localStorage を一度読むだけだったため）。lib/localStorageStore ベースの
// 共有ストアに直したことを、実際に両方を同時にマウントして確認する。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { makeFakeStore } from "@/testing/renderWithRouter";

// Records the `options` CodeView is given each render, so a test can assert
// on the *derived* values (line height from font size, diffStyle) rather
// than any DOM style attribute.
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({}));
    return (
      <div data-testid="scroll-root">
        <span data-testid="line-height">{props.options.itemMetrics.lineHeight}</span>
        <span data-testid="diff-style">{props.options.diffStyle}</span>
      </div>
    );
  });
  return { CodeView };
});

vi.mock("@/components/tree/PathTree", () => ({
  PathTree: () => <div data-testid="path-tree-stub" />,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    healthApi: {
      get: () =>
        Promise.resolve({ ok: true, version: "0", herdr: { connected: false, protocol: null } }),
    },
  };
});

const { default: DiffPanel } = await import("./DiffPanel.tsx");
const { SettingsDialog } = await import("@/components/settings/SettingsDialog");

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function patchWithOneFile() {
  return {
    patch:
      "diff --git a/a.txt b/a.txt\n" +
      "index e69de29..d95f3ad 100644\n" +
      "--- a/a.txt\n" +
      "+++ b/a.txt\n" +
      "@@ -0,0 +1 @@\n" +
      "+hello\n",
    hash: "h1",
    generatedAt: "2026-09-03T00:00:00.000Z",
    files: [
      {
        name: "a.txt",
        prevName: null,
        hash: "h-a.txt",
        oldHash: null,
        newHash: null,
        untracked: false,
      },
    ],
    untrackedCount: 0,
    untrackedTruncated: false,
    untrackedErrors: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(patchWithOneFile())),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBoth() {
  const queryClient = new QueryClient();
  const store = makeFakeStore();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HerdrStoreProvider store={store}>
          <DiffPanel repo="/repo" repoChangedTick={0} />
          <SettingsDialog open onOpenChange={() => {}} />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

test("changing the code font size in the settings dialog updates an already-open DiffPanel", async () => {
  renderBoth();
  await waitFor(() => expect(screen.getByTestId("line-height")).toBeInTheDocument());
  const before = screen.getByTestId("line-height").textContent;

  fireEvent.click(screen.getByRole("button", { name: "文字を大きく" }));

  await waitFor(() => expect(screen.getByTestId("line-height").textContent).not.toBe(before));
});

test("changing Diff's default split/unified in the settings dialog updates an already-open DiffPanel", async () => {
  renderBoth();
  await waitFor(() => expect(screen.getByTestId("diff-style")).toHaveTextContent("split"));

  fireEvent.mouseDown(screen.getByRole("tab", { name: "unified" }));

  await waitFor(() => expect(screen.getByTestId("diff-style")).toHaveTextContent("unified"));
});
