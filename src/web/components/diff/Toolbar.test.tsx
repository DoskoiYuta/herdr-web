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
    onCollapseAll: vi.fn(),
    onExpandAll: vi.fn(),
    disabled: false,
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
  expect(screen.getByTitle("split / unified")).toHaveTextContent("split");
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

test("collapse-all / expand-all buttons call their handlers", () => {
  const props = baseProps();
  render(<Toolbar {...props} />);
  fireEvent.click(screen.getByText("すべて折りたたむ"));
  expect(props.onCollapseAll).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("すべて展開"));
  expect(props.onExpandAll).toHaveBeenCalledOnce();
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
