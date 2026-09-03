import { cleanup, fireEvent, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./state.ts";

// A CodeView stand-in that's smart enough to exercise DiffView's collapse
// wiring: it actually renders each item's header (calling
// options.renderHeaderPrefix, like the real library does) inside a
// data-diffs-header element, and exposes getInstance().getRenderedItems()
// (id + light-DOM host element) the way the real CodeView does, so DiffView's
// native composedPath()-based header-click listener has something real to
// walk. It does NOT use an actual shadow root — composedPath() over plain
// light DOM behaves the same way for this function's purposes.
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      scrollTo: vi.fn(),
      getInstance: () => ({
        getRenderedItems: () =>
          (props.items ?? []).map((item: any) => ({
            id: item.id,
            element: document.querySelector(`[data-item-host="${item.id}"]`),
          })),
      }),
    }));
    const { containerRef, className, items = [] } = props;
    return (
      <div ref={containerRef} className={className} data-testid="scroll-root">
        {items.map((item: any) => (
          <div key={item.id} data-item-host={item.id}>
            <div data-diffs-header="default">
              {props.renderHeaderPrefix?.(item)}
              <span data-testid={`title-${item.id}`}>{item.fileDiff.name}</span>
            </div>
            <div data-testid={`body-${item.id}`}>code</div>
          </div>
        ))}
      </div>
    );
  });
  return { CodeView };
});

const { default: DiffView } = await import("./DiffView.tsx");

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

function fileDiff(name: string) {
  return { name, type: "change", hunks: [] } as any;
}

function makeItem(id: string, name: string, collapsed = false) {
  return { id, type: "diff" as const, fileDiff: fileDiff(name), version: 1, collapsed };
}

test("clicking the chevron toggle reports the item id exactly once", () => {
  const onToggleCollapse = vi.fn();
  const { getByLabelText } = render(
    <DiffView
      items={[makeItem("diff:a.ts#1", "a.ts")]}
      settings={DEFAULT_SETTINGS}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
      onToggleCollapse={onToggleCollapse}
    />,
  );

  fireEvent.click(getByLabelText("a.ts を折りたたむ"));

  expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  expect(onToggleCollapse).toHaveBeenCalledWith("diff:a.ts#1");
});

test("the chevron reflects collapsed state via aria-expanded and label", () => {
  const { getByLabelText } = render(
    <DiffView
      items={[makeItem("diff:a.ts#1", "a.ts", true)]}
      settings={DEFAULT_SETTINGS}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
      onToggleCollapse={() => {}}
    />,
  );

  const button = getByLabelText("a.ts を展開");
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

test("clicking anywhere else in the file header also toggles collapse", () => {
  const onToggleCollapse = vi.fn();
  const { getByTestId } = render(
    <DiffView
      items={[makeItem("diff:a.ts#1", "a.ts")]}
      settings={DEFAULT_SETTINGS}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
      onToggleCollapse={onToggleCollapse}
    />,
  );

  fireEvent.click(getByTestId("title-diff:a.ts#1"));

  expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  expect(onToggleCollapse).toHaveBeenCalledWith("diff:a.ts#1");
});

test("clicking the code body (outside the header) does not toggle collapse", () => {
  const onToggleCollapse = vi.fn();
  const { getByTestId } = render(
    <DiffView
      items={[makeItem("diff:a.ts#1", "a.ts")]}
      settings={DEFAULT_SETTINGS}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
      onToggleCollapse={onToggleCollapse}
    />,
  );

  fireEvent.click(getByTestId("body-diff:a.ts#1"));

  expect(onToggleCollapse).not.toHaveBeenCalled();
});

test("clicking a different file's header toggles that file, not others", () => {
  const onToggleCollapse = vi.fn();
  const { getByTestId } = render(
    <DiffView
      items={[makeItem("diff:a.ts#1", "a.ts"), makeItem("diff:b.ts#1", "b.ts")]}
      settings={DEFAULT_SETTINGS}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
      onToggleCollapse={onToggleCollapse}
    />,
  );

  fireEvent.click(getByTestId("title-diff:b.ts#1"));

  expect(onToggleCollapse).toHaveBeenCalledExactlyOnceWith("diff:b.ts#1");
});
