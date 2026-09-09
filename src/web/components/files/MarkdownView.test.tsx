import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

test("read-only mode renders markdown and disables editing", async () => {
  render(<MarkdownView contents={"# 見出し\n\n- 項目"} />);
  expect(await screen.findByRole("heading", { level: 1, name: "見出し" })).toBeInTheDocument();
  expect(screen.getByText("項目")).toBeInTheDocument();
  const editable = document.querySelector(".ProseMirror");
  expect(editable).toHaveAttribute("contenteditable", "false");
});

test("edit mode reports markdown changes via onChange", async () => {
  const onChange = vi.fn();
  render(<MarkdownView contents={"hello"} onChange={onChange} />);
  const p = await screen.findByText("hello");
  const textNode = p.firstChild as Text;
  textNode.textContent = "hello world";
  p.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: " world" }),
  );
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls.at(-1)?.[0]).toContain("hello world");
});

test("restores scrollTop on the outer scroller on mount", async () => {
  render(<MarkdownView contents={"body"} scrollTop={42} />);
  await screen.findByText("body");
  const scroller = document.querySelector(".overflow-auto") as HTMLElement | null;
  expect(scroller).not.toBeNull();
  expect(scroller?.scrollTop).toBe(42);
});

test("mounting in edit mode does not report the editor's normalized markdown as a change", async () => {
  const onChange = vi.fn();
  render(<MarkdownView contents={"|a|b|\n|-|-|\n|1|2|\n"} onChange={onChange} />);
  await screen.findByText("1");
  await new Promise((r) => setTimeout(r, 50));
  expect(onChange).not.toHaveBeenCalled();
});
