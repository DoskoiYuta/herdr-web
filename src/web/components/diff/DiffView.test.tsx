import { cleanup, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { fontMetrics } from "./reconcile.ts";
import { DEFAULT_SETTINGS } from "./state.ts";
import type { Settings } from "./state.ts";

// Minimal stand-in for @pierre/diffs/react's CodeView: just forwards
// `containerRef` onto a real DOM node so the CSS-custom-property writes have
// somewhere real to land (mirrors tdiff's test/client/DiffView.test.tsx).
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      scrollTo: vi.fn(),
    }));
    const { containerRef } = props;
    return <div ref={containerRef} data-testid="scroll-root" />;
  });
  return { CodeView };
});

const { default: DiffView } = await import("./DiffView.tsx");

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

function renderDiffView(settings: Settings) {
  return render(
    <DiffView
      items={[]}
      settings={settings}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
    />,
  );
}

test("CSS custom properties are applied to the container on first render", () => {
  const { getByTestId } = renderDiffView(DEFAULT_SETTINGS);
  const node = getByTestId("scroll-root") as HTMLDivElement;
  const metrics = fontMetrics(DEFAULT_SETTINGS.fontSize);

  expect(node.style.getPropertyValue("--diffs-font-size")).toBe(`${metrics.fontSize}px`);
  expect(node.style.getPropertyValue("--diffs-line-height")).toBe(`${metrics.lineHeight}px`);
  expect(node.style.getPropertyValue("--diffs-font-family")).toContain("JetBrainsMono Nerd Font");
});

test("CSS custom properties stay in sync when fontSize changes", () => {
  const { getByTestId, rerender } = renderDiffView(DEFAULT_SETTINGS);
  const node = getByTestId("scroll-root") as HTMLDivElement;

  const nextSettings: Settings = { ...DEFAULT_SETTINGS, fontSize: DEFAULT_SETTINGS.fontSize + 4 };
  rerender(
    <DiffView
      items={[]}
      settings={nextSettings}
      repo="/repo"
      onToast={() => {}}
      onTopItemChange={() => {}}
    />,
  );

  const metrics = fontMetrics(nextSettings.fontSize);
  expect(node.style.getPropertyValue("--diffs-font-size")).toBe(`${metrics.fontSize}px`);
  expect(node.style.getPropertyValue("--diffs-line-height")).toBe(`${metrics.lineHeight}px`);
});
