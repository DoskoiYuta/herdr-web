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

// レビュー指摘: アップロード進捗のような「完了するまで消えてはいけない」
// toast が、既定の 4/8 秒タイムアウトで消えてしまっていた。
test("useToast: a sticky toast does not auto-dismiss even long after the default timeouts", () => {
  vi.useFakeTimers();
  function StickyTrigger() {
    const toast = useToast();
    useEffect(() => {
      toast({ kind: "info", message: "インポート中… (3 件)", sticky: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  render(
    <ToastProvider>
      <StickyTrigger />
    </ToastProvider>,
  );
  act(() => vi.advanceTimersByTime(20000));
  assert.ok(screen.getByText("インポート中… (3 件)"));
  vi.useRealTimers();
});

// id を指定して呼ぶと、既存の同じ id の toast をスタックに積まず置き換える
// （進捗 → 完了/失敗の 1 本のメッセージとして見せるため）。
test("useToast: calling with the same id replaces the existing toast instead of stacking", () => {
  function ReplaceTrigger() {
    const toast = useToast();
    useEffect(() => {
      toast({ kind: "info", message: "インポート中… (3 件)", sticky: true, id: "upload" });
      toast({ kind: "success", message: "3 件をインポートしました", id: "upload" });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  render(
    <ToastProvider>
      <ReplaceTrigger />
    </ToastProvider>,
  );
  assert.equal(screen.getAllByTestId("toast").length, 1);
  assert.ok(screen.getByText("3 件をインポートしました"));
  assert.equal(screen.queryByText("インポート中… (3 件)"), null);
});

// dismiss(id) で sticky な toast を明示的に消せる（自動タイムアウト無しで
// 消す唯一の手段）。
test("useToast: dismiss(id) removes a sticky toast", () => {
  function DismissTrigger() {
    const toast = useToast();
    useEffect(() => {
      toast({ kind: "info", message: "作業中", sticky: true, id: "job" });
      toast.dismiss("job");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  render(
    <ToastProvider>
      <DismissTrigger />
    </ToastProvider>,
  );
  assert.equal(screen.queryByText("作業中"), null);
});
