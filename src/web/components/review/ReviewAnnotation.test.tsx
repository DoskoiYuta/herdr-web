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
    anchor: { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc",
    viewedAs: { from: "HEAD", to: "WORKTREE" },
    status: "open",
    thread: [{ seq: 0, author: "user", body: "please fix", at: "t", agentSession: null }],
    notify: { state: "pending", pane: null, at: null },
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

test("ComposerAnnotation submits the trimmed body", async () => {
  const onSubmit = vi.fn(async () => {});
  render(<ComposerAnnotation onSubmit={onSubmit} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("コメントを追加"), {
    target: { value: "  looks off  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "コメント" }));
  expect(onSubmit).toHaveBeenCalledWith("looks off");
});

test("ComposerAnnotation cancel calls onCancel", () => {
  const onCancel = vi.fn();
  render(<ComposerAnnotation onSubmit={vi.fn()} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(onCancel).toHaveBeenCalled();
});

test("ReviewsAnnotation renders the thread, status badge, and notify state", () => {
  const match: ForDiffMatch = { review: review(), line: 1, confidence: "exact" };
  render(
    <ReviewsAnnotation
      matches={[match]}
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReanchor={vi.fn()}
      onResend={vi.fn()}
    />,
  );
  expect(screen.getByText("please fix")).toBeInTheDocument();
  expect(screen.getByTestId("review-status-badge")).toHaveTextContent("open");
  expect(screen.getByText("再送")).toBeInTheDocument();
  expect(screen.queryByText("位置は推定")).not.toBeInTheDocument();
});

test("ReviewsAnnotation dims a line-confidence match and shows the estimate note", () => {
  const match: ForDiffMatch = { review: review(), line: 1, confidence: "line" };
  render(
    <ReviewsAnnotation
      matches={[match]}
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReanchor={vi.fn()}
      onResend={vi.fn()}
    />,
  );
  expect(screen.getByText("位置は推定")).toBeInTheDocument();
  expect(screen.getByTestId("review-thread")).toHaveClass("opacity-60");
});

test("ReviewsAnnotation shows a reanchor button only when outdated, resolve otherwise", () => {
  const outdated: ForDiffMatch = {
    review: review({ status: "outdated" }),
    line: 1,
    confidence: "exact",
  };
  render(
    <ReviewsAnnotation
      matches={[outdated]}
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReanchor={vi.fn()}
      onResend={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "再アンカー" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "解決" })).toBeInTheDocument();
});

test("ReviewsAnnotation resolve/reply/resend wire up to the callbacks", async () => {
  const onResolve = vi.fn(async () => {});
  const onReply = vi.fn(async () => {});
  const onResend = vi.fn(async () => {});
  const match: ForDiffMatch = { review: review(), line: 1, confidence: "exact" };
  render(
    <ReviewsAnnotation
      matches={[match]}
      onReply={onReply}
      onResolve={onResolve}
      onReanchor={vi.fn()}
      onResend={onResend}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "解決" }));
  expect(onResolve).toHaveBeenCalledWith("r1");

  fireEvent.change(screen.getByPlaceholderText("返信"), { target: { value: "ok will fix" } });
  fireEvent.click(screen.getByRole("button", { name: "返信" }));
  expect(onReply).toHaveBeenCalledWith("r1", "ok will fix");

  fireEvent.click(screen.getByText("再送"));
  expect(onResend).toHaveBeenCalledWith("r1");
});
