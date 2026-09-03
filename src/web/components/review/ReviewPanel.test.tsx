import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Review } from "@contract/review";
import type { ReviewEvent } from "@/lib/herdrStore";
import { ReviewPanel } from "./ReviewPanel";

// ReviewPanel fetches via useReviewList (TanStack Query) — needs a provider.
function render(ui: ReactElement) {
  const client = new QueryClient();
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const listMock = vi.fn();
const commitMock = vi.fn();

vi.mock("@/lib/api", () => ({
  reviewApi: {
    list: (...args: unknown[]) => listMock(...args),
  },
  gitApi: {
    commit: (...args: unknown[]) => commitMock(...args),
  },
}));

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r-open",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [
      {
        seq: 0,
        author: "user",
        body: "check this",
        at: "2026-09-01T00:00:00.000Z",
        agentSession: null,
      },
    ],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const OPEN_WORKTREE = review({ id: "r-open", status: "open", path: "a.txt" });
const RESOLVED_COMMIT = review({
  id: "r-resolved",
  status: "resolved",
  path: "b.txt",
  target: { kind: "commit", hash: "deadbeef" },
  updatedAt: "2026-09-02T00:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([OPEN_WORKTREE, RESOLVED_COMMIT]);
  commitMock.mockResolvedValue({ parents: ["parent-hash"] });
});

afterEach(() => cleanup());

test("lists reviews for the repo/worktree, newest first", async () => {
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={vi.fn()} />);
  expect(listMock).toHaveBeenCalledWith({
    repo: "/repo/.git",
    worktree: "/repo",
    all: true,
    unreachable: false,
  });
  // resolved is filtered out by the default status filter (open/replied/outdated)
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  expect(screen.queryByText("b.txt")).not.toBeInTheDocument();
});

test("toggling the resolved status filter shows resolved reviews", async () => {
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByLabelText("resolved"));
  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());
});

test("filtering by target kind narrows the list", async () => {
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText("resolved"));
  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText("target"), { target: { value: "commit" } });
  expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
  expect(screen.getByText("b.txt")).toBeInTheDocument();
});

test("filtering by path substring narrows the list", async () => {
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText("path"), { target: { value: "zzz" } });
  expect(screen.queryByText("a.txt")).not.toBeInTheDocument();
  expect(screen.getByText("レビューはありません。")).toBeInTheDocument();
});

test("clicking a worktree-bound review navigates with a null comparison and the anchor's location", async () => {
  const onNavigate = vi.fn();
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={onNavigate} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByText("a.txt"));
  expect(onNavigate).toHaveBeenCalledWith({
    comparison: null,
    location: { path: "a.txt", line: 1, side: "new" },
  });
});

test("clicking a commit-bound review navigates with a hash^..hash comparison", async () => {
  const onNavigate = vi.fn();
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={onNavigate} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText("resolved"));
  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByText("b.txt"));
  await waitFor(() =>
    expect(onNavigate).toHaveBeenCalledWith({
      comparison: { from: "deadbeef^", to: "deadbeef" },
      location: { path: "b.txt", line: 1, side: "new" },
    }),
  );
  expect(commitMock).toHaveBeenCalledWith({ repo: "/repo/.git", hash: "deadbeef" });
});

test("clicking a review on a root commit (no parent) routes to Graph instead of an invalid hash^ diff", async () => {
  commitMock.mockResolvedValue({ parents: [] });
  const onNavigate = vi.fn();
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={onNavigate} />);
  await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText("resolved"));
  await waitFor(() => expect(screen.getByText("b.txt")).toBeInTheDocument());

  fireEvent.click(screen.getByText("b.txt"));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ routeToGraph: true }));
});

test("toggling unreachable refetches with the flag set", async () => {
  render(<ReviewPanel repoKey="/repo/.git" worktreeRoot="/repo" onNavigate={vi.fn()} />);
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByLabelText("unreachable"));
  await waitFor(() =>
    expect(listMock).toHaveBeenLastCalledWith({
      repo: "/repo/.git",
      worktree: "/repo",
      all: true,
      unreachable: true,
    }),
  );
});

test("a review WS event for a different repo does not trigger a refetch", async () => {
  let emit: ((event: ReviewEvent) => void) | undefined;
  const subscribeReviewEvents = vi.fn((cb: (event: ReviewEvent) => void) => {
    emit = cb;
    return () => {};
  });
  render(
    <ReviewPanel
      repoKey="/repo/.git"
      worktreeRoot="/repo"
      onNavigate={vi.fn()}
      subscribeReviewEvents={subscribeReviewEvents}
    />,
  );
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

  emit?.({ type: "review", event: "created", review: review({ repo: "/other-repo/.git" }) });
  expect(listMock).toHaveBeenCalledTimes(1);

  emit?.({ type: "review", event: "created", review: review({ repo: "/repo/.git" }) });
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
});

test("shows a message and skips fetching when repoKey is not resolved", () => {
  render(<ReviewPanel repoKey={null} worktreeRoot="/repo" onNavigate={vi.fn()} />);
  expect(listMock).not.toHaveBeenCalled();
  expect(screen.getByText("リポジトリを解決できていません。")).toBeInTheDocument();
});
