import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithStore } from "@/testing/renderWithRouter";
import { comparisonLabel } from "./DiffPanel.tsx";

// Minimal stand-in for @pierre/diffs/react's CodeView (same pattern as
// DiffView.test.tsx) plus a button that lets a test simulate CodeView
// reporting a scroll position, to exercise DiffPanel's
// scrolled-away-from-top vs. auto-apply banner logic. Also records
// scrollToItem calls and renders each item's id/collapsed flag (in the
// `items` prop order DiffPanel hands it) so tests can assert on per-file
// collapse and right-pane ordering without the real virtualized renderer.
export const scrollToItemMock = vi.fn();
export const scrollToLineMock = vi.fn();
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      scrollTo: (target: any) => {
        if (target?.type === "item") scrollToItemMock(target.id);
        if (target?.type === "line") scrollToLineMock(target.id, target.lineNumber, target.side);
      },
    }));
    const { containerRef, items = [] } = props;
    return (
      <div ref={containerRef} data-testid="scroll-root">
        <button
          type="button"
          data-testid="simulate-scroll-away"
          onClick={() => props.onScroll?.(100, { getTopForItem: () => undefined })}
        />
        <ol data-testid="item-order">
          {items.map((item: any) => (
            <li key={item.id} data-collapsed={!!item.collapsed} data-name={item.fileDiff.name}>
              {item.id}
            </li>
          ))}
        </ol>
      </div>
    );
  });
  return { CodeView };
});

// Stub PathTree with one button per path, mirroring FilesPanel.test.tsx's
// pattern — the real @pierre/trees rendering is exercised by PathTree's own
// tests, not by DiffPanel's.
vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({
    paths,
    onSelectFile,
  }: {
    paths: string[];
    onSelectFile?: (path: string) => void;
  }) => (
    <div data-testid="path-tree-stub">
      {paths.map((p) => (
        <button key={p} type="button" onClick={() => onSelectFile?.(p)}>
          {p}
        </button>
      ))}
    </div>
  ),
}));

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
  scrollToItemMock.mockClear();
  scrollToLineMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(props: React.ComponentProps<typeof DiffPanel>) {
  return renderWithStore(<DiffPanel {...props} />);
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

// 無いと壊れる: Graph で選んだ明示的な範囲の表示が既定の "vs" 表記のままになり、
// design.pen の "→" 表記（比較範囲 chip）と揃わない。
test("comparisonLabel: an explicit separator replaces 'vs'", () => {
  expect(comparisonLabel("abcdef1234567890", "0123456789abcdef", "→")).toBe("0123456 → abcdef1");
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
  const { rerender } = renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h2", [{ name: "b.txt", contentLine: "world" }])),
  );
  rerender(<DiffPanel repo="/repo" repoChangedTick={1} />);

  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("shows an update banner (not auto-applied) when scrolled away from top, and applies on click", async () => {
  const { rerender } = renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("simulate-scroll-away"));

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h2", [{ name: "b.txt", contentLine: "world" }])),
  );
  rerender(<DiffPanel repo="/repo" repoChangedTick={1} />);

  await waitFor(() => expect(screen.getByText("変更があります")).toBeInTheDocument());
  expect(screen.getByText("a.txt")).toBeInTheDocument();
  expect(screen.queryByText("b.txt")).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("↻ 更新 (r)"));

  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("auto-applies when the currently displayed diff is empty, even scrolled away from top", async () => {
  fetchMock.mockImplementation(async () => jsonResponse(patch("h0", [])));
  const { rerender } = renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText(/0 files/)).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("simulate-scroll-away"));

  fetchMock.mockImplementation(async () =>
    jsonResponse(patch("h1", [{ name: "a.txt", contentLine: "hello" }])),
  );
  rerender(<DiffPanel repo="/repo" repoChangedTick={1} />);

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(screen.queryByText("変更があります")).not.toBeInTheDocument();
});

test("calls onInitialLocationConsumed once after jumping, and doesn't re-jump once the parent clears it", async () => {
  const onInitialLocationConsumed = vi.fn();
  const { rerender } = renderPanel({
    repo: "/repo",
    repoChangedTick: 0,
    initialLocation: { path: "a.txt", line: 1, side: "new" as const },
    onInitialLocationConsumed,
  });
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
    <DiffPanel
      repo="/repo"
      repoChangedTick={1}
      initialLocation={null}
      onInitialLocationConsumed={onInitialLocationConsumed}
    />,
  );
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(onInitialLocationConsumed).toHaveBeenCalledTimes(1);
});

test("a path-only initialLocation (Graph file-row jump) scrolls to the file heading, not a line", async () => {
  const onInitialLocationConsumed = vi.fn();
  renderPanel({
    repo: "/repo",
    repoChangedTick: 0,
    initialLocation: { path: "a.txt" },
    onInitialLocationConsumed,
  });
  await waitFor(() => expect(scrollToItemMock).toHaveBeenCalled());
  expect(scrollToLineMock).not.toHaveBeenCalled();
  expect(onInitialLocationConsumed).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Per-file collapse (M3 follow-up)
// ---------------------------------------------------------------------------

test("toolbar すべて折りたたむ/すべて展開 collapse and expand every file", async () => {
  fetchMock.mockImplementation(async () =>
    jsonResponse(
      patch("h1", [
        { name: "a.txt", contentLine: "hello" },
        { name: "b.txt", contentLine: "world" },
      ]),
    ),
  );
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  const collapsedOf = (name: string) =>
    document.querySelector(`[data-name="${name}"]`)?.getAttribute("data-collapsed");

  expect(collapsedOf("a.txt")).toBe("false");
  expect(collapsedOf("b.txt")).toBe("false");

  fireEvent.click(screen.getByTitle("すべて折りたたむ"));
  expect(collapsedOf("a.txt")).toBe("true");
  expect(collapsedOf("b.txt")).toBe("true");

  fireEvent.click(screen.getByTitle("すべて展開"));
  expect(collapsedOf("a.txt")).toBe("false");
  expect(collapsedOf("b.txt")).toBe("false");
});

test("clicking a file in the PathTree expands it (if collapsed) and scrolls to it", async () => {
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  const collapsedOfA = () =>
    document.querySelector('[data-name="a.txt"]')?.getAttribute("data-collapsed");

  fireEvent.click(screen.getByTitle("すべて折りたたむ"));
  expect(collapsedOfA()).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "a.txt" }));

  await waitFor(() => expect(collapsedOfA()).toBe("false"));
  await waitFor(() => expect(scrollToItemMock).toHaveBeenCalled());
});

// ---------------------------------------------------------------------------
// Right-pane order follows the FileTree (part 2)
// ---------------------------------------------------------------------------

test("the right pane orders files like the FileTree (dirs first, alphabetical), not git's patch order", async () => {
  // Patch order deliberately not tree order: root z.ts first, then src/*.
  fetchMock.mockImplementation(async () =>
    jsonResponse(
      patch("h1", [
        { name: "z.ts", contentLine: "z" },
        { name: "src/b.ts", contentLine: "b" },
        { name: "src/a.ts", contentLine: "a" },
      ]),
    ),
  );
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByText("z.ts")).toBeInTheDocument());

  const order = screen.getByTestId("item-order").querySelectorAll("li");
  expect(Array.from(order).map((li) => li.getAttribute("data-name"))).toEqual([
    "src/a.ts",
    "src/b.ts",
    "z.ts",
  ]);
});

// docs/ui-redesign.md §5.4: no changes vs HEAD gets a dedicated empty state
// (branch/HEAD + "Graph を開く"), not a blank viewer. Without this, a repo
// with nothing to review would look indistinguishable from one still loading.
test("shows the empty state (with a working Graph-open button) when the patch has no files and no untracked", async () => {
  fetchMock.mockImplementation(async () => jsonResponse(patch("h1", [])));
  const onOpenGraph = vi.fn();
  renderPanel({ repo: "/repo", repoChangedTick: 0, onOpenGraph });
  await waitFor(() => expect(screen.getByText("作業ツリーは HEAD と同じです")).toBeInTheDocument());
  expect(screen.queryByTestId("scroll-root")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Graph を開く" }));
  expect(onOpenGraph).toHaveBeenCalledTimes(1);
});

test("does not show the empty state while a non-empty patch is still the only one ever applied", async () => {
  renderPanel({ repo: "/repo", repoChangedTick: 0 });
  await waitFor(() => expect(screen.getByTestId("scroll-root")).toBeInTheDocument());
  expect(screen.queryByText("作業ツリーは HEAD と同じです")).not.toBeInTheDocument();
});
