import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Review } from "@contract/review";
import type { ReviewEvent } from "@/lib/herdrStore";
import { renderWithStore } from "@/testing/renderWithRouter";

// Same minimal CodeView stand-in as DiffPanel.test.tsx / DiffView.test.tsx,
// extended to (a) let a test fire a line selection and (b) render whatever
// `renderAnnotation` produces for each item's annotations, so the composer
// and inline review thread can be exercised without the real @pierre/diffs
// virtualized renderer (which needs a real layout engine jsdom doesn't have).
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    const { containerRef, items, options, onSelectedLinesChange, renderAnnotation } = props;
    return (
      <div ref={containerRef} data-testid="scroll-root">
        <button
          type="button"
          data-testid="drag-start"
          onClick={() => options?.onLineSelectionStart?.({ start: 2, side: "additions", end: 2 })}
        />
        <button
          type="button"
          data-testid="drag-end"
          onClick={() => options?.onLineSelectionEnd?.({ start: 2, side: "additions", end: 2 })}
        />
        <button
          type="button"
          data-testid="select-new-line-2"
          onClick={() =>
            onSelectedLinesChange?.({
              id: items[0]?.id,
              range: { start: 2, side: "additions", end: 2 },
            })
          }
        />
        <button
          type="button"
          data-testid="select-new-lines-3-to-2-reversed"
          onClick={() =>
            // Simulates dragging upward: @pierre/diffs reports start/end in
            // drag order, so start (3) > end (2) here.
            onSelectedLinesChange?.({
              id: items[0]?.id,
              range: { start: 3, side: "additions", end: 2 },
            })
          }
        />
        {items.flatMap((item: any) =>
          (item.annotations ?? []).map((annotation: any, i: number) => (
            <div key={`${item.id}:${i}`} data-testid="annotation">
              {renderAnnotation?.(annotation, item)}
            </div>
          )),
        )}
      </div>
    );
  });
  return { CodeView };
});

const createMock = vi.fn();
const forDiffMock = vi.fn();
const replyMock = vi.fn();
const resolveMock = vi.fn();

const patchMock = vi.fn();

vi.mock("@/lib/api", () => ({
  gitApi: {
    root: vi.fn(async (path: string) => ({
      root: path,
      commonDir: `${path}/.git`,
      branch: "main",
      isMain: true,
      head: "headHash",
      rootCommit: "headHash",
    })),
    files: vi.fn(),
    patch: (...args: unknown[]) => patchMock(...args),
  },
  reviewApi: {
    forDiff: (...args: unknown[]) => forDiffMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    reply: (...args: unknown[]) => replyMock(...args),
    resolve: (...args: unknown[]) => resolveMock(...args),
    reanchor: vi.fn(),
    notify: vi.fn(),
    editDraft: vi.fn(),
    deleteDraft: vi.fn(),
  },
}));

// Stub PathTree the same way DiffPanel.test.tsx does — this file exercises
// review annotations, not tree rendering.
vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({ paths }: { paths: string[] }) => (
    <div data-testid="path-tree-stub">
      {paths.map((p) => (
        <div key={p}>{p}</div>
      ))}
    </div>
  ),
}));

const { default: DiffPanel } = await import("./DiffPanel.tsx");

function patchFor(fileName: string) {
  return {
    patch:
      `diff --git a/${fileName} b/${fileName}\n` +
      `index e69de29..d95f3ad 100644\n` +
      `--- a/${fileName}\n` +
      `+++ b/${fileName}\n` +
      `@@ -1,3 +1,4 @@\n` +
      ` line1\n` +
      `-line2\n` +
      `+line2-changed\n` +
      `+line2b\n` +
      ` line3\n`,
    hash: "h1",
    generatedAt: "2026-09-03T00:00:00.000Z",
    files: [
      {
        name: fileName,
        prevName: null,
        hash: "hf",
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

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: {
      side: "new",
      lines: ["line2-changed"],
      before: ["line1"],
      after: ["line2b", "line3"],
      lineHint: 2,
      hash: "h",
    },
    createdAtHead: "headHash",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [
      {
        seq: 0,
        author: "user",
        body: "please double-check",
        at: "t",
        agentSession: null,
        draft: false,
      },
    ],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  patchMock.mockResolvedValue(patchFor("a.txt"));
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  return renderWithStore(<DiffPanel repo="/repo" repoKey="/repo/.git" repoChangedTick={0} />);
}

test("selecting a line opens the composer; submitting calls reviewApi.create with the right body", async () => {
  forDiffMock.mockResolvedValue([]);
  createMock.mockResolvedValue(review());
  renderPanel();

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("select-new-line-2"));
  const textarea = await screen.findByPlaceholderText("コメントを追加");
  fireEvent.change(textarea, { target: { value: "please double-check" } });
  fireEvent.click(screen.getByRole("button", { name: "下書きを追加" }));

  await waitFor(() => expect(createMock).toHaveBeenCalled());
  const body = createMock.mock.calls[0]![0];
  expect(body).toMatchObject({
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    target: { kind: "worktree", root: "/repo" },
    path: "a.txt",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    body: "please double-check",
  });
  expect(body.anchor).toMatchObject({ side: "new", lines: ["line2-changed"] });
  expect(body.anchor.hash).toMatch(/^[0-9a-f]{40}$/);
});

test("the composer stays closed while the mouse button is held and opens once the drag ends", async () => {
  forDiffMock.mockResolvedValue([]);
  renderPanel();

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("drag-start"));
  fireEvent.click(screen.getByTestId("select-new-line-2"));
  expect(screen.queryByPlaceholderText("コメントを追加")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("drag-end"));
  expect(await screen.findByPlaceholderText("コメントを追加")).toBeInTheDocument();
});

test("a reversed multi-line selection (dragged upward) still builds an anchor covering both lines in order", async () => {
  forDiffMock.mockResolvedValue([]);
  createMock.mockResolvedValue(review());
  renderPanel();

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByTestId("select-new-lines-3-to-2-reversed"));
  const textarea = await screen.findByPlaceholderText("コメントを追加");
  fireEvent.change(textarea, { target: { value: "range comment" } });
  fireEvent.click(screen.getByRole("button", { name: "下書きを追加" }));

  await waitFor(() => expect(createMock).toHaveBeenCalled());
  const body = createMock.mock.calls[0]![0];
  expect(body.anchor).toMatchObject({ side: "new", lines: ["line2-changed", "line2b"] });
});

test("renders a matched review inline via forDiff, and resolve calls reviewApi.resolve", async () => {
  const match = { review: review(), line: 2, span: 1, confidence: "exact" as const };
  forDiffMock.mockResolvedValue([match]);
  renderPanel();

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("please double-check")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "解決" }));
  await waitFor(() => expect(resolveMock).toHaveBeenCalledWith("r1"));
});

test("a line-confidence match is dimmed with a 位置は推定 note", async () => {
  const match = { review: review(), line: 2, span: 1, confidence: "line" as const };
  forDiffMock.mockResolvedValue([match]);
  renderPanel();

  await waitFor(() => expect(screen.getByText("位置は推定")).toBeInTheDocument());
});

test("composer submit is disabled with a hint until createdAtHead resolves", async () => {
  forDiffMock.mockResolvedValue([]);
  const { gitApi } = await import("@/lib/api");
  let resolveRoot!: (v: Awaited<ReturnType<typeof gitApi.root>>) => void;
  vi.mocked(gitApi.root).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRoot = resolve;
      }),
  );
  renderPanel();

  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("select-new-line-2"));
  await screen.findByPlaceholderText("コメントを追加");

  expect(screen.getByRole("button", { name: "下書きを追加" })).toBeDisabled();
  expect(screen.getByText(/HEAD を解決できていません/)).toBeInTheDocument();

  resolveRoot({
    root: "/repo",
    commonDir: "/repo/.git",
    branch: "main",
    isMain: true,
    head: "headHash",
    rootCommit: "headHash",
  });
  await waitFor(() =>
    expect(screen.queryByText(/HEAD を解決できていません/)).not.toBeInTheDocument(),
  );
  fireEvent.change(screen.getByPlaceholderText("コメントを追加"), {
    target: { value: "please double-check" },
  });
  expect(screen.getByRole("button", { name: "下書きを追加" })).not.toBeDisabled();
});

test("a review WS event for a different repo does not trigger a for-diff refetch", async () => {
  forDiffMock.mockResolvedValue([]);
  const { store } = renderPanel();
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  await waitFor(() => expect(forDiffMock).toHaveBeenCalledTimes(1));

  store.emitReview({
    type: "review",
    event: "created",
    review: review({ repo: "/other-repo/.git" }),
  } satisfies ReviewEvent);
  // No new call should be scheduled — give the 200ms debounce window time to
  // pass and confirm it stayed quiet.
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(forDiffMock).toHaveBeenCalledTimes(1);

  store.emitReview({
    type: "review",
    event: "created",
    review: review({ repo: "/repo/.git" }),
  } satisfies ReviewEvent);
  await waitFor(() => expect(forDiffMock).toHaveBeenCalledTimes(2));
});

test("stale inline annotations are dropped when repoKey changes, not left showing a different repo's thread", async () => {
  const match = { review: review(), line: 2, span: 1, confidence: "exact" as const };
  forDiffMock.mockResolvedValue([match]);
  const { rerender } = renderPanel();
  await waitFor(() => expect(screen.getByText("please double-check")).toBeInTheDocument());

  // Simulate the repoKey resolving to a different repository while `repo`
  // (the worktree path) stays the same — should clear stale annotations
  // immediately rather than keep showing the old repo's review thread until
  // the new forDiff call resolves.
  forDiffMock.mockImplementation(() => new Promise(() => {}));
  rerender(<DiffPanel repo="/repo" repoKey="/other-repo/.git" repoChangedTick={0} />);

  await waitFor(() => expect(screen.queryByText("please double-check")).not.toBeInTheDocument());
});
