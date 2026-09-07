import assert from "node:assert/strict";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { test, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

function Trigger({
  message = "hello",
  kind = "info" as const,
  action,
}: {
  message?: string;
  kind?: "info" | "success" | "warning" | "error";
  action?: { label: string; onClick: () => void };
}) {
  const toast = useToast();
  useEffect(() => {
    toast({ kind, message, action });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

test("useToast: shows a toast with the given message", () => {
  render(
    <ToastProvider>
      <Trigger message="下書きを追加しました" />
    </ToastProvider>,
  );
  assert.ok(screen.getByText("下書きを追加しました"));
});

test("useToast: without an action, the toast auto-dismisses around 4s but not immediately", () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Trigger message="消えるやつ" />
    </ToastProvider>,
  );
  assert.ok(screen.getByText("消えるやつ"));
  act(() => vi.advanceTimersByTime(3000));
  assert.ok(screen.getByText("消えるやつ"));
  act(() => vi.advanceTimersByTime(2000));
  assert.equal(screen.queryByText("消えるやつ"), null);
  vi.useRealTimers();
});

test("useToast: with an action, the toast survives past 4s but dismisses by 8s", () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Trigger message="アクション付き" action={{ label: "再送", onClick: () => {} }} />
    </ToastProvider>,
  );
  act(() => vi.advanceTimersByTime(5000));
  assert.ok(screen.getByText("アクション付き"));
  act(() => vi.advanceTimersByTime(4000));
  assert.equal(screen.queryByText("アクション付き"), null);
  vi.useRealTimers();
});

test("useToast: multiple toasts stack (all visible at once)", () => {
  function TwoTriggers() {
    const toast = useToast();
    useEffect(() => {
      toast({ kind: "info", message: "first" });
      toast({ kind: "info", message: "second" });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  render(
    <ToastProvider>
      <TwoTriggers />
    </ToastProvider>,
  );
  assert.ok(screen.getByText("first"));
  assert.ok(screen.getByText("second"));
});

test("useToast: clicking the action button calls onClick", () => {
  const onClick = vi.fn();
  render(
    <ToastProvider>
      <Trigger message="再送してね" action={{ label: "再送", onClick }} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "再送" }));
  assert.equal(onClick.mock.calls.length, 1);
});
