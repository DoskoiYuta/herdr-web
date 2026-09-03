import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { comparisonLabel } from "./DiffPanel.tsx";

// Minimal stand-in for @pierre/diffs/react's CodeView (same pattern as
// DiffView.test.tsx) plus a button that lets a test simulate CodeView
// reporting a scroll position, to exercise DiffPanel's
// scrolled-away-from-top vs. auto-apply banner logic.
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    const { containerRef } = props;
    return (
      <div ref={containerRef} data-testid="scroll-root">
        <button
          type="button"
          data-testid="simulate-scroll-away"
          onClick={() => props.onScroll?.(100, { getTopForItem: () => undefined })}
        />
      </div>
    );
  });
  return { CodeView };
});

const { default: DiffPanel } = await import("./DiffPanel.tsx");

function patch(hash: string, files: { name: string; contentLine: string }[]) {
  const patchText = files
    .map(
      (f) =>
        `diff --git a/${f.name} b/${f.name}\n` +
        `index e69de29..d95f3ad 100644\n` +
        `--- a/${f.name}\n` +
        `+++ b/${f.name}\n` +
        `@@ -0,0 +1 @@\n` +
        `+${f.contentLine}\n`,
    )
    .join("");
  return {
    patch: patchText,
    hash,
    generatedAt: "2026-09-03T00:00:00.000Z",
    files: files.map((f) => ({
      name: f.name,
      prevName: null,
      hash: `h-${f.name}`,
      oldHash: null,
      newHash: null,
      untracked: false,
    })),
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    jsonResponse(patch("h1", [{ name: "a.txt", contentLine: "hello" }])),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(props: { repo: string; from?: string; to?: string; repoChangedTick: number }) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <DiffPanel {...props} />
    </QueryClientProvider>,
  );
}

test("comparisonLabel: defaults to WORKTREE vs HEAD", () => {
  expect(comparisonLabel(undefined, undefined)).toBe("WORKTREE vs HEAD");
});

test("comparisonLabel: INDEX vs HEAD", () => {
  expect(comparisonLabel("HEAD", "INDEX")).toBe("INDEX vs HEAD");
});

test("comparisonLabel: two commit hashes are shortened to 7 chars", () => {
  expect(comparisonLabel("abcdef1234567890", "0123456789abcdef")).toBe("0123456 vs abcdef1");
});

test("renders the comparison label from from/to props", () => {
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  expect(screen.getByText("WORKTREE vs HEAD")).toBeInTheDocument();
});

test("auto-applies the first fetched patch (nothing was displayed yet)", async () => {
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(screen.getByText(/1 files \+1 -0/)).toBeInTheDocument();
});

test("auto-applies a changed patch while scrolled at the top (no banner)", async () => {
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={0} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h2", [{ name: "b.txt", contentLine: "world" }])),
  );
  rerender(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={1} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("shows an update banner (not auto-applied) when scrolled away from top, and applies on click", async () => {
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={0} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("simulate-scroll-away"));

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h2", [{ name: "b.txt", contentLine: "world" }])),
  );
  rerender(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={1} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("変更があります")).toBeInTheDocument());
  expect(screen.getByText("a.txt")).toBeInTheDocument();
  expect(screen.queryByText("b.txt")).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("↻ 更新 (r)"));

  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("auto-applies when the currently displayed diff is empty, even scrolled away from top", async () => {
  fetchMock.mockImplementation(async () => jsonResponse(patch("h0", [])));
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={0} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(/0 files/)).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("simulate-scroll-away"));

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h1", [{ name: "a.txt", contentLine: "hello" }])),
  );
  rerender(
    <QueryClientProvider client={client}>
      <DiffPanel repo="/repo" repoChangedTick={1} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("calls onInitialLocationConsumed once after jumping, and doesn't re-jump once the parent clears it", async () => {
  const onInitialLocationConsumed = vi.fn();
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <DiffPanel
        repo="/repo"
        repoChangedTick={0}
        initialLocation={{ path: "a.txt", line: 1, side: "new" }}
        onInitialLocationConsumed={onInitialLocationConsumed}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  await waitFor(() => expect(onInitialLocationConsumed).toHaveBeenCalledTimes(1));

  // Parent reacts to the callback by clearing initialLocation to null (as it
  // must — see ToolPane's handleInitialLocationConsumed). A later poller
  // refresh (bumping repoChangedTick, which changes `items`) must not
  // re-trigger the jump.
  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h2", [{ name: "a.txt", contentLine: "hello" }])),
  );
  rerender(
    <QueryClientProvider client={client}>
      <DiffPanel
        repo="/repo"
        repoChangedTick={1}
        initialLocation={null}
        onInitialLocationConsumed={onInitialLocationConsumed}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(onInitialLocationConsumed).toHaveBeenCalledTimes(1);
});
