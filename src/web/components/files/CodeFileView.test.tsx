import { cleanup, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useLayoutEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";

const scrollToMock = vi.fn();
// Latest `onScroll` prop CodeFileView passed down, so tests can fire a scroll
// report at a chosen moment instead of being at the mercy of React's effect
// ordering.
let capturedOnScroll: ((top: number) => void) | undefined;

// Minimal stand-in for @pierre/diffs/react's CodeView (same approach as
// DiffView.test.tsx): exposes the imperative `scrollTo` handle as a spy, and
// fires `onScroll` from its own mount/update layout effect to simulate items
// being swapped in before the parent's own restoring effect has run (child
// layout effects commit before the parent's in React).
vi.mock("@pierre/diffs/react", () => {
  // biome-ignore lint: test double
  const CodeView = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ scrollTo: scrollToMock }), []);
    capturedOnScroll = props.onScroll ? (top: number) => props.onScroll(top, {}) : undefined;
    useLayoutEffect(() => {
      props.onScroll?.(9999, {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.items]);
    return <div data-testid="code-view-stub" />;
  });
  return { CodeView };
});

const { CodeFileView } = await import("./CodeFileView.tsx");

afterEach(() => {
  cleanup();
  scrollToMock.mockClear();
});

test.each([
  { name: "no scrollTop given: restores to 0", scrollTop: undefined, want: 0 },
  { name: "a scrollTop given: restores to it", scrollTop: 250, want: 250 },
])("scrollTo is called with the restored position on mount ($name)", ({ scrollTop, want }) => {
  render(<CodeFileView path="a.ts" contents="const x = 1;" fontSize={14} scrollTop={scrollTop} />);
  expect(scrollToMock).toHaveBeenCalledWith({
    type: "position",
    position: want,
    behavior: "instant",
  });
});

test("changing path scrolls to the new path's restored position, not the previous one", () => {
  const { rerender } = render(
    <CodeFileView path="a.ts" contents="a" fontSize={14} scrollTop={100} />,
  );
  scrollToMock.mockClear();
  rerender(<CodeFileView path="b.ts" contents="b" fontSize={14} scrollTop={300} />);
  expect(scrollToMock).toHaveBeenCalledWith({
    type: "position",
    position: 300,
    behavior: "instant",
  });
});

test("re-rendering the same path with a changed scrollTop does not scroll again", () => {
  const { rerender } = render(
    <CodeFileView path="a.ts" contents="a" fontSize={14} scrollTop={100} />,
  );
  scrollToMock.mockClear();
  rerender(<CodeFileView path="a.ts" contents="a" fontSize={14} scrollTop={999} />);
  expect(scrollToMock).not.toHaveBeenCalled();
});

test("onScroll fired before the path's restoration effect runs is not reported", () => {
  // The mock's own layout effect fires onScroll(9999, ...) on mount, before
  // CodeFileView's restoring effect (a parent layout effect) has marked the
  // path as restored — that stale report must be dropped.
  const onScrollTopChange = vi.fn();
  render(
    <CodeFileView
      path="a.ts"
      contents="a"
      fontSize={14}
      scrollTop={100}
      onScrollTopChange={onScrollTopChange}
    />,
  );
  expect(onScrollTopChange).not.toHaveBeenCalled();
});

test("onScroll fired after restoration is reported", () => {
  const onScrollTopChange = vi.fn();
  render(
    <CodeFileView
      path="a.ts"
      contents="a"
      fontSize={14}
      scrollTop={100}
      onScrollTopChange={onScrollTopChange}
    />,
  );
  // Mount's own onScroll (fired pre-restoration by the mock) is dropped; call
  // it again now that mount (and CodeFileView's restoring effect) has settled.
  capturedOnScroll?.(42);
  expect(onScrollTopChange).toHaveBeenCalledWith(42);
});
