import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AskComposer } from "./AskComposer";

test("送信先を選ぶ… opens the target dialog with the entered body", () => {
  const onOpenTargetDialog = vi.fn();
  render(<AskComposer onCancel={vi.fn()} onOpenTargetDialog={onOpenTargetDialog} />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.click(screen.getByText("送信先を選ぶ…"));
  expect(onOpenTargetDialog).toHaveBeenCalledWith("why?");
});

// Without this, a blank submission would open the target dialog with nothing
// to send.
test("送信先を選ぶ… does nothing while the body is empty", () => {
  const onOpenTargetDialog = vi.fn();
  render(<AskComposer onCancel={vi.fn()} onOpenTargetDialog={onOpenTargetDialog} />);
  fireEvent.click(screen.getByText("送信先を選ぶ…"));
  expect(onOpenTargetDialog).not.toHaveBeenCalled();
});

test("⌘Enter also opens the target dialog", () => {
  const onOpenTargetDialog = vi.fn();
  render(<AskComposer onCancel={vi.fn()} onOpenTargetDialog={onOpenTargetDialog} />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.keyDown(screen.getByPlaceholderText("質問を入力"), { key: "Enter", metaKey: true });
  expect(onOpenTargetDialog).toHaveBeenCalledWith("why?");
});

test("Escape cancels", () => {
  const onCancel = vi.fn();
  render(<AskComposer onCancel={onCancel} onOpenTargetDialog={vi.fn()} />);
  fireEvent.keyDown(screen.getByPlaceholderText("質問を入力"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
});

test("キャンセル calls onCancel", () => {
  const onCancel = vi.fn();
  render(<AskComposer onCancel={onCancel} onOpenTargetDialog={vi.fn()} />);
  fireEvent.click(screen.getByText("キャンセル"));
  expect(onCancel).toHaveBeenCalled();
});

test("disabled blocks opening the dialog and shows the reason", () => {
  const onOpenTargetDialog = vi.fn();
  render(<AskComposer onCancel={vi.fn()} onOpenTargetDialog={onOpenTargetDialog} disabled />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.click(screen.getByText("送信先を選ぶ…"));
  expect(onOpenTargetDialog).not.toHaveBeenCalled();
  expect(
    screen.getByText("リポジトリを解決できていません（少し待ってから再度お試しください）"),
  ).toBeInTheDocument();
});
