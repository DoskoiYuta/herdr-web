import { cleanup, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { fontMetrics } from "@/lib/codeFont";
import { DEFAULT_SETTINGS } from "./state.ts";

// Minimal stand-in for @pierre/diffs/react's CodeView: just forwards
// `containerRef` onto a real DOM node so the CSS-custom-property writes have
// somewhere real to land (mirrors tdiff's test/client/DiffView.test.tsx).
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      scrollTo: vi.fn(),
    }));
    const { containerRef, className } = props;
    return <div ref={containerRef} className={className} data-testid="scroll-root" />;
  });
  return { CodeView };
});

const { default: DiffView } = await import("./DiffView.tsx");

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

function renderDiffView(fontSize: number) {
  return render(
    <DiffView
      items={[]}
      settings={DEFAULT_SETTINGS}
      fontSize={fontSize}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
    />,
  );
}

const DEFAULT_FONT_SIZE = 15;

test("CSS custom properties are applied to the container on first render", () => {
  const { getByTestId } = renderDiffView(DEFAULT_FONT_SIZE);
  const node = getByTestId("scroll-root") as HTMLDivElement;
  const metrics = fontMetrics(DEFAULT_FONT_SIZE);

  expect(node.style.getPropertyValue("--diffs-font-size")).toBe(`${metrics.fontSize}px`);
  expect(node.style.getPropertyValue("--diffs-line-height")).toBe(`${metrics.lineHeight}px`);
  expect(node.style.getPropertyValue("--diffs-font-family")).toContain("JetBrainsMono Nerd Font");
});

test("the CodeView container gets the scroll-root sizing/overflow classes", () => {
  // Regression test: without a bounded height + overflow-y-auto on this
  // exact node, the diff pane's content can grow past the viewport with no
  // scrollbar (there is no `.scroll-root` CSS rule anywhere in the app —
  // that id is just a DOM hook — so scrolling depends entirely on these
  // Tailwind classes landing on CodeView's own container element).
  const { getByTestId } = renderDiffView(DEFAULT_FONT_SIZE);
  const node = getByTestId("scroll-root") as HTMLDivElement;

  expect(node.classList.contains("h-full")).toBe(true);
  expect(node.classList.contains("min-h-0")).toBe(true);
  expect(node.classList.contains("overflow-y-auto")).toBe(true);
});

test("CSS custom properties stay in sync when fontSize changes", () => {
  const { getByTestId, rerender } = renderDiffView(DEFAULT_FONT_SIZE);
  const node = getByTestId("scroll-root") as HTMLDivElement;

  const nextFontSize = DEFAULT_FONT_SIZE + 4;
  rerender(
    <DiffView
      items={[]}
      settings={DEFAULT_SETTINGS}
      fontSize={nextFontSize}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
    />,
  );

  const metrics = fontMetrics(nextFontSize);
  expect(node.style.getPropertyValue("--diffs-font-size")).toBe(`${metrics.fontSize}px`);
  expect(node.style.getPropertyValue("--diffs-line-height")).toBe(`${metrics.lineHeight}px`);
});
