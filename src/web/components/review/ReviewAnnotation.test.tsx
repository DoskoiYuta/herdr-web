import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { Review } from "@contract/review";
import type { ForDiffMatch } from "@/lib/api";
import { ComposerAnnotation, ReviewsAnnotation } from "./ReviewAnnotation";

afterEach(() => cleanup());

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    repo: "/repo/.git",
    target: { kind: "worktree", root: "/repo" },
    worktreeRoot: "/repo",
    path: "a.txt",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [
      { seq: 0, author: "user", body: "please fix", at: "t", agentSession: null, draft: false },
    ],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

function renderAnnotation(
  matches: ForDiffMatch[],
  overrides: Partial<React.ComponentProps<typeof ReviewsAnnotation>> = {},
) {
  return render(
    <ReviewsAnnotation
      matches={matches}
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReanchor={vi.fn()}
      onResend={vi.fn()}
      onEditDraft={vi.fn()}
      onDeleteDraft={vi.fn()}
      {...overrides}
    />,
  );
}

test("ComposerAnnotation submits the trimmed body", async () => {
  const onSubmit = vi.fn(async () => {});
  render(<ComposerAnnotation onSubmit={onSubmit} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("コメントを追加"), {
    target: { value: "  looks off  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "下書きを追加" }));
  expect(onSubmit).toHaveBeenCalledWith("looks off");
});

test("ComposerAnnotation cancel calls onCancel", () => {
  const onCancel = vi.fn();
  render(<ComposerAnnotation onSubmit={vi.fn()} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(onCancel).toHaveBeenCalled();
});

test("ReviewsAnnotation renders the thread, status badge, and notify state", () => {
  const match: ForDiffMatch = { review: review(), line: 1, span: 1, confidence: "exact" };
  renderAnnotation([match]);
  expect(screen.getByText("please fix")).toBeInTheDocument();
  expect(screen.getByTestId("review-status-badge")).toHaveTextContent("open");
  expect(screen.getByText("再送")).toBeInTheDocument();
  expect(screen.queryByText("位置は推定")).not.toBeInTheDocument();
});

test("ReviewsAnnotation dims a line-confidence match and shows the estimate note", () => {
  const match: ForDiffMatch = { review: review(), line: 1, span: 1, confidence: "line" };
  renderAnnotation([match]);
  expect(screen.getByText("位置は推定")).toBeInTheDocument();
  expect(screen.getByTestId("review-thread")).toHaveClass("opacity-60");
});

test("ReviewsAnnotation shows a reanchor button only when outdated, resolve otherwise", () => {
  const outdated: ForDiffMatch = {
    review: review({ status: "outdated" }),
    line: 1,
    span: 1,
    confidence: "exact",
  };
  renderAnnotation([outdated]);
  expect(screen.getByRole("button", { name: "再アンカー" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "解決" })).toBeInTheDocument();
});

test("ReviewsAnnotation resolve/reply/resend wire up to the callbacks", async () => {
  const onResolve = vi.fn(async () => {});
  const onReply = vi.fn(async () => {});
  const onResend = vi.fn(async () => {});
  const match: ForDiffMatch = { review: review(), line: 1, span: 1, confidence: "exact" };
  renderAnnotation([match], { onReply, onResolve, onResend });
  fireEvent.click(screen.getByRole("button", { name: "解決" }));
  expect(onResolve).toHaveBeenCalledWith("r1");

  fireEvent.change(screen.getByPlaceholderText("返信"), { target: { value: "ok will fix" } });
  fireEvent.click(screen.getByRole("button", { name: "返信" }));
  expect(onReply).toHaveBeenCalledWith("r1", "ok will fix");

  fireEvent.click(screen.getByText("再送"));
  expect(onResend).toHaveBeenCalledWith("r1");
});

test("the reply box shows a hint that replies are batched by the send button", () => {
  const match: ForDiffMatch = { review: review(), line: 1, span: 1, confidence: "exact" };
  renderAnnotation([match]);
  expect(screen.getByText("送信ボタンでまとめて送信")).toBeInTheDocument();
});

test("a draft entry shows a 下書き badge and no notify indicator when the review has no sent entry", () => {
  const draftOnly = review({
    thread: [{ seq: 0, author: "user", body: "wip", at: "t", agentSession: null, draft: true }],
  });
  const match: ForDiffMatch = { review: draftOnly, line: 1, span: 1, confidence: "exact" };
  renderAnnotation([match]);
  expect(screen.getByText("下書き")).toBeInTheDocument();
  expect(screen.queryByText("再送")).not.toBeInTheDocument();
  expect(screen.queryByText("未通知")).not.toBeInTheDocument();
});

test("a review with at least one sent entry still shows the notify indicator even with a later draft reply", () => {
  const mixed = review({
    thread: [
      { seq: 0, author: "user", body: "please fix", at: "t", agentSession: null, draft: false },
      { seq: 1, author: "user", body: "also this", at: "t", agentSession: null, draft: true },
    ],
  });
  const match: ForDiffMatch = { review: mixed, line: 1, span: 1, confidence: "exact" };
  renderAnnotation([match]);
  expect(screen.getByText("再送")).toBeInTheDocument();
});

test("editing a draft entry calls onEditDraft with the review id, seq, and new body", () => {
  const draftOnly = review({
    thread: [{ seq: 0, author: "user", body: "wip", at: "t", agentSession: null, draft: true }],
  });
  const match: ForDiffMatch = { review: draftOnly, line: 1, span: 1, confidence: "exact" };
  const onEditDraft = vi.fn();
  renderAnnotation([match], { onEditDraft });

  fireEvent.click(screen.getByRole("button", { name: "編集" }));
  const textarea = screen.getByDisplayValue("wip");
  fireEvent.change(textarea, { target: { value: "edited body" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(onEditDraft).toHaveBeenCalledWith("r1", 0, "edited body");
});

test("deleting a draft entry calls onDeleteDraft with the review id and seq", () => {
  const draftOnly = review({
    thread: [{ seq: 0, author: "user", body: "wip", at: "t", agentSession: null, draft: true }],
  });
  const match: ForDiffMatch = { review: draftOnly, line: 1, span: 1, confidence: "exact" };
  const onDeleteDraft = vi.fn();
  renderAnnotation([match], { onDeleteDraft });

  fireEvent.click(screen.getByRole("button", { name: "削除" }));
  expect(onDeleteDraft).toHaveBeenCalledWith("r1", 0);
});

test("shows an L<start>–L<end> range label for a multi-line match, but not a single-line one", () => {
  const match: ForDiffMatch = { review: review(), line: 1, span: 1, confidence: "exact" };
  const { rerender } = renderAnnotation([match], { ranges: { r1: { start: 2, end: 2 } } });
  expect(screen.queryByText("L2–L2")).not.toBeInTheDocument();

  rerender(
    <ReviewsAnnotation
      matches={[match]}
      ranges={{ r1: { start: 2, end: 4 } }}
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReanchor={vi.fn()}
      onResend={vi.fn()}
      onEditDraft={vi.fn()}
      onDeleteDraft={vi.fn()}
    />,
  );
  expect(screen.getByText("L2–L4")).toBeInTheDocument();
});
