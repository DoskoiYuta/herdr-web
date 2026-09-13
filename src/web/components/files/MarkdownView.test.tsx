import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

test("reports the parsed (normalized) markdown once before any user edit", async () => {
  const onNormalized = vi.fn();
  render(<MarkdownView contents={"* item"} onChange={() => {}} onNormalized={onNormalized} />);
  await screen.findByText("item");
  await waitFor(() => expect(onNormalized).toHaveBeenCalledTimes(1));
  expect(onNormalized.mock.calls[0]?.[0]).toContain("- item");
});

test("suppresses an update that lands before the deferred normalized capture runs", async () => {
  // `onNormalized` is captured a tick (setTimeout 0) after mount so it can
  // see ProseMirror's own schema fix-ups (e.g. a trailing table gets an
  // empty paragraph appended once mounted in a live view — not reproducible
  // in jsdom, so this exercises the gate itself with fake timers: any
  // `onUpdate` landing before that setTimeout fires — real fix-up or a
  // genuine edit — must not reach `onChange`, or a file could be marked
  // dirty with no edit the user actually asked to keep. A later, real edit
  // (after the capture) must still come through.
  vi.useFakeTimers();
  try {
    const onChange = vi.fn();
    const onNormalized = vi.fn();
    render(<MarkdownView contents={"hello"} onChange={onChange} onNormalized={onNormalized} />);
    const p = screen.getByText("hello");
    const textNode = p.firstChild as Text;
    textNode.textContent = "hello world";
    p.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: " world" }),
    );
    // ProseMirror's DOM→state sync runs on a microtask, not a fake timer.
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();

    await vi.runAllTimersAsync(); // fires the deferred normalized capture
    expect(onNormalized).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    const p2 = screen.getByText("hello world");
    const textNode2 = p2.firstChild as Text;
    textNode2.textContent = "hello world!";
    p2.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("read-only mode does not render the editing toolbar", async () => {
  render(<MarkdownView contents={"body"} />);
  await screen.findByText("body");
  expect(screen.queryByRole("button", { name: "表を挿入" })).not.toBeInTheDocument();
});

test("inserting a table from the toolbar reports table markdown via onChange", async () => {
  const onChange = vi.fn();
  render(<MarkdownView contents={"hello"} onChange={onChange} />);
  await screen.findByText("hello");
  fireEvent.click(await screen.findByRole("button", { name: "表を挿入" }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const markdown = onChange.mock.calls.at(-1)?.[0] as string;
  const tableLines = markdown.split("\n").filter((line) => line.includes("|"));
  expect(tableLines.length).toBeGreaterThanOrEqual(3);
});
