import assert from "node:assert/strict";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { test, vi } from "vitest";
import { ThreadCard, type ThreadCardProps } from "./ThreadCard";

function baseProps(overrides: Partial<ThreadCardProps> = {}): ThreadCardProps {
  return {
    kind: "review",
    location: "DiffView.tsx:L43–45",
    turn: "progress",
    unread: false,
    messages: [{ author: "user", at: "2026-09-07T00:00:00Z", body: "hello" }],
    reply: { placeholder: "返信", onSubmit: vi.fn() },
    actions: [],
    ...overrides,
  };
}

test.each(["done", "void"] as const)("ThreadCard: shows a status chip when turn=%s", (turn) => {
  render(<ThreadCard {...baseProps({ turn })} />);
  assert.ok(screen.getByTestId("status-chip"));
});

test.each(["action", "progress"] as const)(
  "ThreadCard: shows no status chip when turn=%s",
  (turn) => {
    render(<ThreadCard {...baseProps({ turn })} />);
    assert.equal(screen.queryByTestId("status-chip"), null);
  },
);

test("ThreadCard: shows a delivery chip only when delivery is given", () => {
  const { rerender } = render(<ThreadCard {...baseProps()} />);
  assert.equal(screen.queryByTestId("delivery-chip"), null);
  rerender(
    <ThreadCard
      {...baseProps({ delivery: { state: "blocked", canResend: true, onResend: vi.fn() } })}
    />,
  );
  assert.ok(screen.getByTestId("delivery-chip"));
});

test("ThreadCard: delivery chip's resend calls the given onResend", () => {
  const onResend = vi.fn();
  render(
    <ThreadCard {...baseProps({ delivery: { state: "blocked", canResend: true, onResend } })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "再送" }));
  assert.equal(onResend.mock.calls.length, 1);
});

test("ThreadCard: renders every message's body", () => {
  render(
    <ThreadCard
      {...baseProps({
        messages: [
          { author: "user", at: "t1", body: "質問です" },
          { author: "agent", at: "t2", body: "回答です" },
        ],
      })}
    />,
  );
  assert.ok(screen.getByText("質問です"));
  assert.ok(screen.getByText("回答です"));
});

test("ThreadCard: a draft message shows edit/delete controls that call their handlers", () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <ThreadCard
      {...baseProps({
        messages: [{ author: "user", at: "t1", body: "下書き", draft: true, onEdit, onDelete }],
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "削除" }));
  assert.equal(onDelete.mock.calls.length, 1);
});

test("ThreadCard: reply Esc clears the draft body without submitting", () => {
  const onSubmit = vi.fn();
  render(<ThreadCard {...baseProps({ reply: { placeholder: "返信", onSubmit } })} />);
  const textarea = screen.getByPlaceholderText("返信");
  fireEvent.change(textarea, { target: { value: "下書き中" } });
  fireEvent.keyDown(textarea, { key: "Escape" });
  assert.equal((textarea as HTMLTextAreaElement).value, "");
  assert.equal(onSubmit.mock.calls.length, 0);
});

test("ThreadCard: reply Cmd+Enter submits the draft body", () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ThreadCard {...baseProps({ reply: { placeholder: "返信", onSubmit } })} />);
  const textarea = screen.getByPlaceholderText("返信");
  fireEvent.change(textarea, { target: { value: "本文" } });
  fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
  assert.equal(onSubmit.mock.calls.length, 1);
  assert.equal(onSubmit.mock.calls[0]?.[0], "本文");
});

test("ThreadCard: each action button calls its onClick", () => {
  const onClick = vi.fn();
  render(<ThreadCard {...baseProps({ actions: [{ label: "解決", onClick }] })} />);
  fireEvent.click(screen.getByRole("button", { name: "解決" }));
  assert.equal(onClick.mock.calls.length, 1);
});

test("ThreadCard: positionEstimated shows an estimated-position note", () => {
  render(<ThreadCard {...baseProps({ positionEstimated: true })} />);
  assert.ok(screen.getByText("位置は推定"));
});

test("ThreadCard: extra content is rendered when given", () => {
  render(<ThreadCard {...baseProps({ extra: <span>session extra</span> })} />);
  assert.ok(screen.getByText("session extra"));
});

test("ThreadCard: an unread action-turn card stops blinking ~2s after becoming visible", () => {
  vi.useFakeTimers();
  render(<ThreadCard {...baseProps({ turn: "action", unread: true })} />);
  const card = screen.getByTestId("thread-card");
  assert.equal(card.dataset.blinking, "true");
  act(() => vi.advanceTimersByTime(2100));
  assert.equal(card.dataset.blinking, "false");
  vi.useRealTimers();
});

test("ThreadCard: an unread action-turn card stops blinking immediately on focus within it", () => {
  render(<ThreadCard {...baseProps({ turn: "action", unread: true })} />);
  const card = screen.getByTestId("thread-card");
  assert.equal(card.dataset.blinking, "true");
  fireEvent.focus(screen.getByPlaceholderText("返信"));
  assert.equal(card.dataset.blinking, "false");
});

test("ThreadCard: a read (unread=false) card never blinks even when turn=action", () => {
  render(<ThreadCard {...baseProps({ turn: "action", unread: false })} />);
  const card = screen.getByTestId("thread-card");
  assert.equal(card.dataset.blinking, "false");
});
