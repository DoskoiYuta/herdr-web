import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./state.ts";
import Toolbar from "./Toolbar.tsx";

function baseProps() {
  return {
    settings: DEFAULT_SETTINGS,
    showTree: true,
    onToggleTree: vi.fn(),
    onToggleDiffStyle: vi.fn(),
    onToggleOverflow: vi.fn(),
    onFontDec: vi.fn(),
    onFontInc: vi.fn(),
    onRefresh: vi.fn(),
    allCollapsed: false,
    onToggleCollapseAll: vi.fn(),
    disabled: false,
    compareLabel: "WORKTREE vs HEAD",
    compareRangeActive: false,
    summary: { files: 0, additions: 0, deletions: 0 },
    generatedAt: null,
    untrackedCount: 0,
    untrackedErrors: 0,
  };
}

test("renders a tree toggle button reflecting settings.showTree", () => {
  render(<Toolbar {...baseProps()} />);
  expect(screen.getByTitle("ファイルツリー")).toHaveAttribute("aria-pressed", "true");
});

test("clicking the tree button calls onToggleTree", () => {
  const props = baseProps();
  render(<Toolbar {...props} />);
  fireEvent.click(screen.getByTitle("ファイルツリー"));
  expect(props.onToggleTree).toHaveBeenCalledOnce();
});

test("toggle buttons reflect current settings and call their handlers", () => {
  const props = baseProps();
  render(<Toolbar {...props} />);
  expect(screen.getByTitle("split / unified")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTitle("split / unified"));
  expect(props.onToggleDiffStyle).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByTitle("更新 (r)"));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

test("disabled disables toolbar controls", () => {
  render(<Toolbar {...baseProps()} disabled={true} />);
  expect(screen.getByTitle("ファイルツリー")).toBeDisabled();
  expect(screen.getByTitle("更新 (r)")).toBeDisabled();
});

// 無いと壊れる: 折りたたみ状態を見せる/切り替える手段が無くなる
// （design.pen: 折りたたみ/展開は 1 個のトグルボタン）。
test("the collapse-all toggle shows the opposite action's title and calls onToggleCollapseAll", () => {
  const props = baseProps();
  const { rerender } = render(<Toolbar {...props} />);
  fireEvent.click(screen.getByTitle("すべて折りたたむ"));
  expect(props.onToggleCollapseAll).toHaveBeenCalledOnce();

  rerender(<Toolbar {...props} allCollapsed={true} />);
  expect(screen.getByTitle("すべて展開")).toBeInTheDocument();
});

// 無いと壊れる: 送信ボタンの置き場所（ui-redesign.md §5.4: Diff の toolbar
// 右端）が無いと、Diff でしか使わない送信操作を出す場所が無くなる。
test("renders the sendButton slot at the toolbar's right end when given", () => {
  render(<Toolbar {...baseProps()} sendButton={<button type="button">送信 (2)</button>} />);
  expect(screen.getByRole("button", { name: "送信 (2)" })).toBeInTheDocument();
});

test("renders nothing extra when sendButton is omitted", () => {
  render(<Toolbar {...baseProps()} />);
  expect(screen.queryByText(/^送信/)).not.toBeInTheDocument();
});

// 無いと壊れる: 比較範囲表示中に送信ボタンが消え、その diff で作った下書きを
// 送れなくなる。作業ツリーに戻る手段は chip の × クリックで足りる。
test("an active compare range still shows sendButton; the chip's × resets to the worktree", () => {
  const onResetToWorktree = vi.fn();
  render(
    <Toolbar
      {...baseProps()}
      compareLabel="abc1234 → def5678"
      compareRangeActive={true}
      onResetToWorktree={onResetToWorktree}
      sendButton={<button type="button">送信 (2)</button>}
    />,
  );
  expect(screen.getByRole("button", { name: "送信 (2)" })).toBeInTheDocument();
  fireEvent.click(screen.getByTitle("比較範囲を解除"));
  expect(onResetToWorktree).toHaveBeenCalledOnce();
});
