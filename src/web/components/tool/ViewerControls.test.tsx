import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ViewerControls } from "./ViewerControls.tsx";

function baseProps() {
  return {
    showTree: true,
    onToggleTree: vi.fn(),
    onFontDec: vi.fn(),
    onFontInc: vi.fn(),
  };
}

test("the tree toggle reflects showTree via aria-pressed", () => {
  render(<ViewerControls {...baseProps()} showTree={false} />);
  expect(screen.getByTitle("ファイルツリー")).toHaveAttribute("aria-pressed", "false");
});

test("clicking the tree/font buttons calls their handlers", () => {
  const props = baseProps();
  render(<ViewerControls {...props} />);
  fireEvent.click(screen.getByTitle("ファイルツリー"));
  expect(props.onToggleTree).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTitle("文字を小さく"));
  expect(props.onFontDec).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTitle("文字を大きく"));
  expect(props.onFontInc).toHaveBeenCalledOnce();
});

test("disabled disables all three buttons", () => {
  render(<ViewerControls {...baseProps()} disabled={true} />);
  expect(screen.getByTitle("ファイルツリー")).toBeDisabled();
  expect(screen.getByTitle("文字を小さく")).toBeDisabled();
  expect(screen.getByTitle("文字を大きく")).toBeDisabled();
});
