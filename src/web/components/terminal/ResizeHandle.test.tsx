import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

afterEach(() => {
  cleanup();
});

const MIN = 140;
const MAX = 600;
const DEFAULT = 240;

function baseProps(width = 240) {
  return {
    width,
    min: MIN,
    max: MAX,
    defaultWidth: DEFAULT,
    onResize: vi.fn(),
    onResizeEnd: vi.fn(),
  };
}

function getHandle() {
  return screen.getByRole("separator");
}

// jsdom has no PointerEvent constructor, and MouseEvent's clientX getter
// can't be overwritten by plain property assignment after construction —
// so build the event via the MouseEvent constructor (which does honor
// clientX in its init dict) and only bolt pointerId on afterward.
function pointerEvent(type: string, init: { pointerId: number; clientX: number }) {
  const event = new MouseEvent(type, {
    clientX: init.clientX,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.assign(event, { pointerId: init.pointerId });
  return event;
}

function pointerDown(el: Element, init: { pointerId: number; clientX: number }) {
  fireEvent(el, pointerEvent("pointerdown", init));
}
function pointerMove(el: Element, init: { pointerId: number; clientX: number }) {
  fireEvent(el, pointerEvent("pointermove", init));
}
function pointerUp(el: Element, init: { pointerId: number; clientX: number }) {
  fireEvent(el, pointerEvent("pointerup", init));
}

test("renders a vertical separator with aria attributes reflecting width", () => {
  render(<ResizeHandle {...baseProps(240)} />);
  const handle = getHandle();
  expect(handle).toHaveAttribute("aria-orientation", "vertical");
  expect(handle).toHaveAttribute("aria-valuenow", "240");
  expect(handle).toHaveAttribute("aria-valuemin", String(MIN));
  expect(handle).toHaveAttribute("aria-valuemax", String(MAX));
});

test("dragging from x=100 to x=160 calls onResize(300) live for startWidth 240 (direction: right)", () => {
  const props = baseProps(240);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  pointerDown(handle, { pointerId: 1, clientX: 100 });
  pointerMove(handle, { pointerId: 1, clientX: 160 });

  expect(props.onResize).toHaveBeenCalledWith(300);
  expect(props.onResizeEnd).not.toHaveBeenCalled();
});

test("releasing the pointer calls onResizeEnd with the final width", () => {
  const props = baseProps(240);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  pointerDown(handle, { pointerId: 1, clientX: 100 });
  pointerMove(handle, { pointerId: 1, clientX: 160 });
  pointerUp(handle, { pointerId: 1, clientX: 160 });

  expect(props.onResizeEnd).toHaveBeenCalledWith(300);
});

test("drag is clamped at min", () => {
  const props = baseProps(140);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  pointerDown(handle, { pointerId: 1, clientX: 200 });
  pointerMove(handle, { pointerId: 1, clientX: 0 });

  expect(props.onResize).toHaveBeenCalledWith(MIN);
});

test("drag is clamped at max", () => {
  const props = baseProps(600);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  pointerDown(handle, { pointerId: 1, clientX: 0 });
  pointerMove(handle, { pointerId: 1, clientX: 5000 });

  expect(props.onResize).toHaveBeenCalledWith(MAX);
});

test("double-click resets to defaultWidth", () => {
  const props = baseProps(400);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  fireEvent.doubleClick(handle);

  expect(props.onResize).toHaveBeenCalledWith(DEFAULT);
  expect(props.onResizeEnd).toHaveBeenCalledWith(DEFAULT);
});

test("ArrowRight increases width by 16 and persists immediately", () => {
  const props = baseProps(240);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  fireEvent.keyDown(handle, { key: "ArrowRight" });

  expect(props.onResize).toHaveBeenCalledWith(256);
  expect(props.onResizeEnd).toHaveBeenCalledWith(256);
});

test("ArrowLeft decreases width by 16 and persists immediately", () => {
  const props = baseProps(240);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  fireEvent.keyDown(handle, { key: "ArrowLeft" });

  expect(props.onResize).toHaveBeenCalledWith(224);
  expect(props.onResizeEnd).toHaveBeenCalledWith(224);
});

test("pointermove for a different pointerId than the active drag is ignored", () => {
  const props = baseProps(240);
  render(<ResizeHandle {...props} />);
  const handle = getHandle();

  pointerDown(handle, { pointerId: 1, clientX: 100 });
  pointerMove(handle, { pointerId: 2, clientX: 500 });

  expect(props.onResize).not.toHaveBeenCalled();
});

describe("direction: left", () => {
  test("dragging left (negative clientX delta) increases width", () => {
    const props = { ...baseProps(240), direction: "left" as const };
    render(<ResizeHandle {...props} />);
    const handle = getHandle();

    pointerDown(handle, { pointerId: 1, clientX: 160 });
    pointerMove(handle, { pointerId: 1, clientX: 100 });

    expect(props.onResize).toHaveBeenCalledWith(300);
  });
});
